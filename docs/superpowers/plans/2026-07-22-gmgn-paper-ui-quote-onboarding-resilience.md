# GMGN Paper UI, Quote, Onboarding, and Marker Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paper trading immediate and deterministic on every supported GMGN chain, keep quick-buy and chart-marker UI correct across GMGN DOM rebuilds, and add safe first-install/common-capital onboarding without introducing any real-money path.

**Architecture:** Keep the existing local state engine and split unstable page behavior into four explicit responsibilities: the GMGN adapter reconciles quick-buy bindings by token identity and live slot; the content runtime resolves synchronous paper quotes from trustworthy live data or deterministic valuation rules; marker publication is event-driven and replayable per iframe; dashboard/background/storage coordinate atomic onboarding and common-capital resets. All accounts, positions, history, PnL, and visible assets remain isolated to the active chain.

**Tech Stack:** Chrome Extension Manifest V3, browser JavaScript, `chrome.storage.local`, Node.js built-in test runner, fake DOM/runtime harnesses, CSS, repository validation/build scripts.

**Safety boundary:** Tests and implementation must never connect a wallet, request a signature or approval, call a swap or transaction RPC, serialize/broadcast a transaction, or invoke a GMGN real-buy/real-sell handler. Only Tango-labeled local paper actions may mutate extension storage.

---

## Task 1: Define deterministic launchpad and unknown-token valuation

**Files:**

- Modify: `src/core/supply.js`
- Modify: `tests/supply.test.js`
- Modify: `tests/gmgn-adapter.test.js`

**Interfaces:**

- Consumes: chain ID, address-bound `launchpad`, `launchMode`, and any trustworthy exact/ratio supply observation.
- Produces: `Tango.Supply.launchpadRule()`, `Tango.Supply.fallbackValuation()`, `UNKNOWN_INITIAL_MARKET_CAP_USD`, `UNKNOWN_TOTAL_SUPPLY`, and the existing `resolve()` result.
- Invariant: a missing quote never implies a token price of `1 USD`; unknown tokens resolve to `$3,200 / 1,000,000,000`.

- [ ] **Step 1: Add failing registry and fallback tests**

Add table-driven coverage in `tests/supply.test.js`:

```js
test('verified launchpad rules expose supply and initial market cap', () => {
  const cases = [
    ['sol', 'pump.fun', '', 1_000_000_000],
    ['sol', 'pump.fun', 'mayhem', 2_000_000_000],
    ['base', 'clanker', '', 100_000_000_000],
    ['robinhood', 'bankr', '', 100_000_000_000],
    ['bsc', 'four.meme', '', 1_000_000_000],
    ['bsc', 'flap', '', 1_000_000_000],
    ['base', 'zora', '', 1_000_000_000],
    ['xlayer', 'bow.fun', '', 1_000_000_000]
  ];
  for (const [chain, launchpad, launchMode, totalSupply] of cases) {
    assert.deepEqual(Supply.launchpadRule(chain, launchpad, launchMode), {
      totalSupply,
      initialMarketCapUsd: 3_200,
      source: 'LAUNCHPAD_RULE'
    });
  }
});

test('unknown launchpads use the fixed 3200 USD and one-billion fallback', () => {
  assert.deepEqual(Supply.fallbackValuation({ chain: 'eth', launchpad: 'unknown' }), {
    totalSupply: 1_000_000_000,
    marketCapUsd: 3_200,
    priceUsd: 0.0000032,
    supplySource: 'UNKNOWN_FALLBACK',
    valuationSource: 'UNKNOWN_INITIAL_MARKET_CAP'
  });
});
```

Extend the address-bound launchpad fixtures in `tests/gmgn-adapter.test.js` to assert that a foreign-address launchpad link cannot select a rule and therefore uses the unknown fallback.

- [ ] **Step 2: Run the focused tests and confirm the failure**

Run:

```powershell
node --test tests/supply.test.js tests/gmgn-adapter.test.js
```

Expected: FAIL because `launchpadRule`, `fallbackValuation`, and the exported constants do not exist, and the current adapter omits a quote when both market-cap and detail data are absent.

- [ ] **Step 3: Implement the data-driven rules and deterministic fallback**

In `src/core/supply.js`, add a frozen registry and keep `ruleSupply()` as a compatibility wrapper:

```js
const UNKNOWN_INITIAL_MARKET_CAP_USD = 3_200;
const UNKNOWN_TOTAL_SUPPLY = 1_000_000_000;

function launchpadRule(chain, launchpad, launchMode) {
  const totalSupply = ruleSupply(chain, launchpad, launchMode);
  return totalSupply > 0 ? {
    totalSupply,
    initialMarketCapUsd: UNKNOWN_INITIAL_MARKET_CAP_USD,
    source: SOURCES.RULE
  } : null;
}

function fallbackValuation(observation = {}) {
  const rule = launchpadRule(observation.chain, observation.launchpad, observation.launchMode);
  const totalSupply = rule?.totalSupply || UNKNOWN_TOTAL_SUPPLY;
  const marketCapUsd = rule?.initialMarketCapUsd || UNKNOWN_INITIAL_MARKET_CAP_USD;
  return {
    totalSupply,
    marketCapUsd,
    priceUsd: marketCapUsd / totalSupply,
    supplySource: rule?.source || 'UNKNOWN_FALLBACK',
    valuationSource: rule ? 'LAUNCHPAD_INITIAL_MARKET_CAP' : 'UNKNOWN_INITIAL_MARKET_CAP'
  };
}
```

Export the constants and functions. Preserve exact GMGN supply and coherent ratio precedence in `resolve()`; do not treat supply-only or cross-address launchpad evidence as a trustworthy live price.

- [ ] **Step 4: Run focused tests and confirm they pass**

Run:

```powershell
node --test tests/supply.test.js tests/gmgn-adapter.test.js
```

Expected: PASS, including every verified rule, Pump Mayhem's 2B supply, Base/Robinhood 100B cases, address binding, and the unknown 1B fallback.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/core/supply.js tests/supply.test.js tests/gmgn-adapter.test.js
git commit -m "fix: define deterministic launchpad valuations"
```

---

## Task 2: Execute every paper order immediately and upgrade only live marks

**Files:**

- Modify: `src/content/content.js`
- Modify: `src/core/engine.js`
- Modify: `tests/content-runtime.test.js`
- Modify: `tests/content-structure.test.js`
- Modify: `tests/engine.test.js`

**Interfaces:**

- Consumes: `Tango.Supply.fallbackValuation()`, same-chain/same-address GMGN observations, trench click snapshots, persisted position quote, and same-chain native-price observations.
- Produces: synchronous `resolvePaperTradeQuote(token, candidate, options)`, immediate `commitBuy()`/`commitSell()`, immutable execution quantity/cost, and live mark upgrades through existing position-quote/calibration storage calls.
- Invariant: quote refresh promises are background-only; a valid paper click commits without awaiting GMGN/network data.

- [ ] **Step 1: Replace old `1 USD` expectations with failing all-chain execution tests**

In `tests/content-runtime.test.js`, replace assertions that expect `quote.priceUsd === 1` when data is absent. Add a six-chain table that verifies quick buy and detail buy both commit synchronously with fallback prices, then verify 25%, 50%, and exact 100% sells:

```js
for (const chain of ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']) {
  test(`${chain} paper orders execute without chart or network quote`, async () => {
    const loaded = loadContent({ chain, tokenPayload: null, chart: false });
    await loaded.quickBuy({ marketCapUsd: 0, launchpad: '' });
    assert.equal(loaded.calls.buyOrders.length, 1);
    assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 3_200 / 1_000_000_000);
    assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 3_200);
  });
}
```

Add an engine regression proving a 1 BNB paper buy at fallback valuation produces a finite large quantity and an exact 100% sell uses the stored remaining quantity rather than rounded percentage arithmetic:

```js
assert.equal(sell.trade.quantity, buy.position.quantity);
assert.equal(sell.position, null);
assert.ok(Number.isFinite(sell.trade.realizedPnlNative));
```

Add contamination tests: reject a live quote with the wrong chain, wrong address, stale timestamp, synthetic provenance, `NaN`, or infinity. Add an upgrade test that records the fallback buy quantity/cost, applies a trustworthy GMGN price, and asserts only mark/PnL/subsequent trade inputs change.

- [ ] **Step 2: Run the focused tests and confirm the failure**

Run:

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js tests/engine.test.js
```

Expected: FAIL because `resolvePaperTradeQuote()` still reaches `historicalPrice || 1`, no-data quantities use 1 USD, and the new immutable-execution/live-mark assertions are not satisfied.

- [ ] **Step 3: Implement one synchronous resolver path**

In `src/content/content.js`, calculate execution price in this order:

```js
const fallback = Tango.Supply.fallbackValuation({
  chain: chain.id,
  launchpad: resolvedLaunchpad,
  launchMode: resolvedLaunchMode
});
const executionMarketCap = safeMarketCapUsd || fallback.marketCapUsd;
const executionSupply = supply?.totalSupply || fallback.totalSupply;
const fallbackPrice = executionMarketCap / executionSupply;
const priceUsd = safeObservedPrice || derivedPrice || historicalPrice || fallbackPrice;
```

Remove the implicit token `|| 1`. Mark fallback source/provenance explicitly and carry `marketCapUsd`, `totalSupply`, `marketCapDivisor`, and `valuationSource` into the order snapshot. Retain the existing explicit provisional native-price rule when no factual native price exists, but keep it separate from token price provenance.

Keep these functions non-blocking before storage mutation:

```js
const quote = resolvePaperTradeQuote(token, clickSnapshot);
const pending = commitBuy({ token, quote, amountNative }, routeCapture);
refreshPaperQuoteInBackground(token);
return pending;
```

In `src/core/engine.js`, validate all numeric inputs before mutation. For 100% sells, select `position.quantity` directly; for partial sells, clamp a calculated quantity to the persisted remaining quantity. Do not recalculate historical buy quantity or cost when a new live mark arrives.

- [ ] **Step 4: Verify execution speed, arithmetic, and isolation**

Run:

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js tests/engine.test.js
```

Expected: PASS; local quick-buy feedback remains under 100 ms without timer advancement, all six chains execute without network data, exact 100% sells are finite, and cross-chain/address quotes are rejected.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/content/content.js src/core/engine.js tests/content-runtime.test.js tests/content-structure.test.js tests/engine.test.js
git commit -m "fix: execute paper orders from deterministic quotes"
```

---

## Task 3: Reconcile quick-buy controls across GMGN sizes and virtual DOM reuse

**Files:**

- Modify: `src/adapters/gmgn.js`
- Modify: `src/content/content.js`
- Modify: `src/content/content.css`
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `tests/content-runtime.test.js`

**Interfaces:**

- Consumes: active GMGN chain, full token address, current trench card, current quick-buy slot, GMGN size/geometry, settings, and click-time card metadata.
- Produces: one `QuickBuyController` binding per `(chain, normalizedAddress, liveSlot)`, bounded affected-node reconciliation, current-slot restoration, and a local Tango paper action.
- Invariant: a Tango click is consumed before GMGN handlers and can never call the hidden/replaced native quick-buy control.

- [ ] **Step 1: Add failing lifecycle and geometry tests**

Extend the fake DOM harness in `tests/gmgn-adapter.test.js` to model distinct card, slot, and native-button nodes. Cover:

```js
for (const size of ['small', 'large', 'extra-large', 'giant']) {
  test(`quick-buy remains aligned in ${size} mode after GMGN replaces its slot`, () => {
    const h = quickBuyHarness({ size });
    GMGN.injectQuickBuy(options(h));
    h.replaceSlotForSameToken();
    h.flushMutations();
    assert.equal(h.paperButtons().length, 1);
    assert.deepEqual(h.paperButtonRect(), h.currentSlotRect());
  });
}
```

Add cases for whole-card replacement, slot replacement, a virtual-list card reused for a different address, zero-size followed by connected nonzero geometry, more than 80 visible slots, rapid mutation batches, disable/restore, and no duplicate paper action after pointer+click. Assert that a stale native node is never reparented into a new card and that the original GMGN click spy remains zero.

In `tests/content-runtime.test.js`, assert that a quick-buy snapshot retains chain/address/name/symbol/logo/market cap/launchpad before same-chain navigation starts.

- [ ] **Step 2: Run the adapter/runtime tests and confirm the failure**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Expected: FAIL on slot/card replacement, virtual-list reuse, or zero-size recovery because the existing adapter tracks long-lived native nodes and a capped discovery list rather than current identity/slot bindings.

- [ ] **Step 3: Implement identity-bound affected-node reconciliation**

In `src/adapters/gmgn.js`, introduce maps keyed by live slot and token identity:

```js
const bindingsBySlot = new WeakMap();
const observedSlots = new Set();
const identityKey = (chain, address) =>
  `${chain}:${Tango.Chains.normalizeAddress(chain, address)}`;

function reconcileCard(card, options) {
  const identity = tokenIdentityFromCard(card, options.chain);
  const slot = currentQuickBuySlot(card);
  if (!identity || !slot) return releaseCardBinding(card);
  return bindCurrentSlot({ card, slot, identity, options });
}
```

Scope `MutationObserver` work to affected trench cards/columns/slots and relevant removed nodes. Use `ResizeObserver` per observed current slot. Defer a connected slot whose geometry is zero; retry it on resize/mutation/bounded repair rather than permanently skipping it. A low-frequency full reconciliation may recover missed nodes but must not run for every mutation and must not cap eligible visible slots at 80.

Capture click metadata before dispatch. Generate a deduplicated action ID and keep the main-world interception restricted to `[data-tango-paper-action="quick-buy"]`.

In `src/content/content.css`, replace fixed offsets with slot-filling flexible layout, size-aware font/label rules, `min-width: 0`, and contained overflow so the amount label works in all four modes.

- [ ] **Step 4: Verify all lifecycle cases**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/page-main.test.js
```

Expected: PASS for all four sizes, current-slot replacement, virtual-list reuse, no duplicates/missing buttons, bounded mutation work, and zero GMGN real-handler invocations.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/adapters/gmgn.js src/content/content.js src/content/content.css tests/gmgn-adapter.test.js tests/content-runtime.test.js
git commit -m "fix: reconcile GMGN quick buy by live token slot"
```

---

## Task 4: Keep the detail panel and token metadata available without chart data

**Files:**

- Modify: `src/adapters/gmgn.js`
- Modify: `src/content/content.js`
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `tests/content-runtime.test.js`

**Interfaces:**

- Consumes: valid GMGN detail route, active chain, normalized address, chain-local trench snapshot, persisted position/trade metadata, and later address-bound GMGN metadata.
- Produces: address-safe detail context and a usable paper buy/sell panel even with no chart iframe or token API payload.
- Invariant: metadata from another address or chain cannot overwrite the current token's name, symbol, or image.

- [ ] **Step 1: Expand the existing no-chart detail test so trading must work**

Extend `every valid detail route renders a placeholder panel without chart or market data` in `tests/content-runtime.test.js` for all six detail routes. Assert that:

```js
assert.ok(loaded.document.querySelector('.tango-paper-panel'));
await loaded.clickPanelBuy();
assert.equal(loaded.calls.buyOrders.length, 1);
assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 3_200);
```

Add trench-to-detail tests where the same chain/address reuses the captured name, symbol, logo, launchpad, and market cap; a different address or same address on another chain must not reuse any of those fields. Add a later-metadata test that upgrades the placeholder only when chain/address match.

- [ ] **Step 2: Run focused tests and confirm the failure**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Expected: FAIL because the existing placeholder coverage does not guarantee usable buy/sell controls and route reconstruction can lose the trench click snapshot before GMGN detail data arrives.

- [ ] **Step 3: Build route context independently from chart/data readiness**

In `src/adapters/gmgn.js`, make valid route parsing return a minimal token immediately:

```js
return {
  token: { chain, address: normalizedAddress },
  quote: {},
  readiness: 'ROUTE_ONLY'
};
```

In `src/content/content.js`, keep a bounded chain+address snapshot cache populated before quick-buy navigation. Resolve metadata in this order: same-identity trench snapshot, same-identity position, same-identity trade, address-only label. Merge later GMGN metadata only through an identity predicate:

```js
function sameToken(left, right) {
  return left?.chain === right?.chain
    && Tango.Chains.normalizeAddress(left.chain, left.address)
      === Tango.Chains.normalizeAddress(right.chain, right.address);
}
```

Make `renderPanel()` depend on valid active route/current token and enabled settings, not on chart presence, positive quote fields, or successful fetch. Show the provisional valuation source until a trustworthy live quote replaces it.

- [ ] **Step 4: Verify panel availability and metadata isolation**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Expected: PASS on every supported detail route with no chart/data; direct buy/sell works immediately and token names/images remain bound to chain plus address.

- [ ] **Step 5: Commit Task 4**

```powershell
git add src/adapters/gmgn.js src/content/content.js tests/gmgn-adapter.test.js tests/content-runtime.test.js
git commit -m "fix: preserve paper panel without GMGN chart data"
```

---

## Task 5: Publish, replay, update, and clear chart markers deterministically

**Files:**

- Modify: `src/content/content.js`
- Modify: `src/content/markers.js`
- Modify: `src/content/chart-main.js`
- Modify: `tests/content-structure.test.js`
- Modify: `tests/content-runtime.test.js`
- Modify: `tests/markers.test.js`

**Interfaces:**

- Consumes: active token identity, chain-local position/trades, current live or provisional valuation, successful storage commits, iframe `READY`, iframe mutations, route/feature state.
- Produces: latest marker payload per active identity, forced post-trade broadcasts, per-frame replay, live-price repositioning, and explicit `{ markers: [] }` clearing.
- Invariant: disabled or invalid routes have no marker overlay, including in chart iframes created after disable.

- [ ] **Step 1: Add failing marker lifecycle tests**

In `tests/content-runtime.test.js`, add tests for:

- trench quick-buy followed immediately by detail navigation publishes an entry line before the 1-second repair tick;
- direct detail buy/sell publishes immediately after storage success;
- an iframe that sends `READY` gets the latest payload even when another frame already received the same signature;
- a replaced/delayed iframe gets replayed markers;
- a trustworthy live quote repositions provisional markers without changing stored trade quantity/cost;
- disabling all features sends an empty payload before `runtime.current` is dropped;
- a frame added while disabled gets only an empty payload.

In `tests/markers.test.js`, assert provisional market-cap markers remain renderable without a factual price and later use factual same-token price scaling. Add a bridge source assertion or harness that an empty payload clears overlay children and cached scale/signature state.

- [ ] **Step 2: Run focused tests and confirm the failure**

Run:

```powershell
node --test tests/content-structure.test.js tests/content-runtime.test.js tests/markers.test.js
```

Expected: FAIL because `commitBuy()`/`commitSell()` do not force publication, iframe signatures are not consumer-lifecycle aware, and disable currently nulls route state without first broadcasting an empty marker payload.

- [ ] **Step 3: Implement event-driven publication and per-frame replay**

In `src/content/content.js`, make successful commits publish immediately:

```js
runtime.state = result.state;
syncChartMarkers(true);
render();
```

Maintain a latest payload independently from the WeakMap of per-frame signatures. On `TANGO_PAPER_CHART/READY`, clear that frame's prior signature and force-send the latest payload. Observe matching iframe additions/removals and replay to each new frame.

Add one explicit clear operation and call it before state teardown:

```js
function clearChartMarkers() {
  runtime.latestMarkerPayload = { markers: [] };
  runtime.markerPayloads = new WeakMap();
  publishChartPayload(runtime.latestMarkerPayload, true);
}
```

Call this on all-features disable, invalid route, and invalid chain before setting `runtime.current = null`. Retain the 1-second tick only as recovery.

In `src/content/markers.js`, preserve market-cap placement when the execution quote is provisional and recompute price placement once a trustworthy current reference exists. In `src/content/chart-main.js`, treat `payload.markers.length === 0` as an explicit clear: empty the overlay, reset rendered/scale signatures and marker positions, and do not recreate visible lines.

- [ ] **Step 4: Verify immediate publication and clearing**

Run:

```powershell
node --test tests/content-structure.test.js tests/content-runtime.test.js tests/markers.test.js
```

Expected: PASS for quick-buy navigation, direct trades, READY/replacement replay, live-price repositioning, immediate disable clearing, and disabled late frames.

- [ ] **Step 5: Commit Task 5**

```powershell
git add src/content/content.js src/content/markers.js src/content/chart-main.js tests/content-structure.test.js tests/content-runtime.test.js tests/markers.test.js
git commit -m "fix: make paper chart markers event driven"
```

---

## Task 6: Add first-install onboarding and atomic common-capital reset

**Files:**

- Modify: `src/background.js`
- Modify: `src/core/state-coordinator.js`
- Modify: `src/core/storage.js`
- Modify: `src/dashboard/dashboard.js`
- Modify: `src/dashboard/dashboard.css`
- Modify: `src/popup/popup.js`
- Modify: `src/shared/i18n.js`
- Modify: `tests/background.test.js`
- Modify: `tests/state-coordinator.test.js`
- Modify: `tests/storage.test.js`
- Modify: `tests/dashboard-runtime.test.js`
- Modify: `tests/popup-runtime.test.js`

**Interfaces:**

- Consumes: `chrome.runtime.onInstalled`, `reason`, `dashboard.html?onboarding=1`, language, a finite common numeric native balance, explicit reset confirmation, and existing settings/state.
- Produces: one atomic `RESET_ALL_WITH_BALANCE` mutation, six independent accounts with the same numeric native balance, verified onboarding completion/close, and popup routing to onboarding when uninitialized.
- Invariant: changing common capital clears all chain balances/positions/trades/PnL/analytics but preserves language/display/behavior settings; install opens onboarding, update does not.

- [ ] **Step 1: Add failing storage/background/onboarding tests**

In `tests/state-coordinator.test.js` and `tests/storage.test.js`, add:

```js
const result = await coordinator.mutate({
  type: 'RESET_ALL_WITH_BALANCE', balanceNative: 25, language: 'zh-CN'
});
for (const chain of Tango.Chains.all()) {
  assert.equal(result.state.accounts[chain.id].cashBalanceNative, 25);
  assert.equal(result.settings.chains[chain.id].initialBalanceNative, 25);
}
assert.deepEqual(result.state.positions, {});
assert.deepEqual(result.state.trades, []);
assert.equal(result.settings.theme, previousTheme);
```

Reject `0`, negative values, `NaN`, infinity, and values above `1e15`; accept values greater than `Number.EPSILON` through `1e15`. Verify mutation failure leaves the old snapshot untouched.

In `tests/background.test.js`, simulate `onInstalled({ reason: 'install' })` and assert one tab opens at `dashboard.html?onboarding=1`; assert `update`, browser update, and repeat events open none.

In `tests/dashboard-runtime.test.js`, cover default `10`, language selection, validation, six equal numeric balances, persisted read-back before `window.close()`, a close fallback completion message, interrupted onboarding with no partial state, and later capital reset only after confirmation.

In `tests/popup-runtime.test.js`, assert an uninitialized popup opens the onboarding URL rather than calling `Tango.Store.initialize(10, language)`.

- [ ] **Step 2: Run focused tests and confirm the failure**

Run:

```powershell
node --test tests/background.test.js tests/state-coordinator.test.js tests/storage.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js
```

Expected: FAIL because background has no `onInstalled` handler, storage has no common-balance reset command, dashboard has no onboarding route, and popup still initializes a fixed balance directly.

- [ ] **Step 3: Add the atomic coordinator/storage command**

In `src/core/state-coordinator.js`, validate before mutation:

```js
function commonBalance(value) {
  const balance = Number(value);
  if (!Number.isFinite(balance) || balance <= Number.EPSILON || balance > 1e15) {
    throw new Error('invalidBalance');
  }
  return balance;
}
```

Handle `RESET_ALL_WITH_BALANCE` in one coordinated mutation: build a fresh initialized state with every supported chain set to `balanceNative`, clear positions/trades/calibrations/PnL data, and update each `settings.chains[chain].initialBalanceNative`. Preserve global/display/behavior settings and apply a supplied onboarding language only when valid.

In `src/core/storage.js`, expose:

```js
async function resetAllWithBalance(balanceNative, language) {
  return runMutation({ type: 'RESET_ALL_WITH_BALANCE', balanceNative, language });
}
```

- [ ] **Step 4: Add install routing and onboarding UI**

In `src/background.js`:

```js
chrome.runtime.onInstalled.addListener((details) => {
  if (details?.reason !== 'install') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html?onboarding=1') });
});
```

In `src/dashboard/dashboard.js`, detect the query parameter, render a dedicated language/common-capital form, default balance to `10`, explain equal numeric native assets and chain independence, and submit through `resetAllWithBalance()`. Read state/settings back and verify all six account balances before calling `window.close()`; if still open, render a completion state.

Change the normal settings page from selected-chain starting capital to one common-capital control. If the value changes, show the approved destructive reset text and call `resetAllWithBalance()` only after confirmation. Language-only changes remain a normal settings patch.

In `src/popup/popup.js`, replace direct fixed initialization with an `open onboarding` action. Add all English/Chinese strings in `src/shared/i18n.js` and responsive onboarding styles in `src/dashboard/dashboard.css`.

- [ ] **Step 5: Verify install/update, atomicity, and close behavior**

Run:

```powershell
node --test tests/background.test.js tests/state-coordinator.test.js tests/storage.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js
```

Expected: PASS; clean install opens once, update never opens onboarding, all six chains receive the entered numeric native balance, interrupted setup persists nothing, and later capital change requires confirmation and preserves non-account settings.

- [ ] **Step 6: Commit Task 6**

```powershell
git add src/background.js src/core/state-coordinator.js src/core/storage.js src/dashboard/dashboard.js src/dashboard/dashboard.css src/popup/popup.js src/shared/i18n.js tests/background.test.js tests/state-coordinator.test.js tests/storage.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js
git commit -m "feat: add common-capital paper onboarding"
```

---

## Task 7: Document behavior, run the full release gate, and rebuild the Chrome directory

**Files:**

- Modify: `README.md`
- Modify: `docs/multichain-smoke-test.md`
- Modify: `tests/release-documentation.test.js`
- Verify: `manifest.json`
- Regenerate: `dist/tango-paper-trader/**`

**Interfaces:**

- Consumes: completed source/tests, build script, six-chain manifest configuration, and the paper-only safety requirements.
- Produces: user documentation, manual GMGN smoke checklist, passing full validation, and refreshed unpacked Chrome extension at `dist/tango-paper-trader`.
- Invariant: the release artifact contains no wallet/signature/swap/transaction capability and documents only Tango paper controls.

- [ ] **Step 1: Add failing release-documentation assertions**

In `tests/release-documentation.test.js`, require README/smoke documentation to mention:

- first-install language and common paper-capital setup;
- equal numeric native capital on Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer;
- active-chain-only balances, positions, history, and top-right assets;
- live GMGN/K-line precedence;
- `$3,200` initial market cap and unknown 1B supply fallback;
- common-capital change resets every chain's paper account/history/PnL after confirmation;
- chart marker replay/disable clearing;
- no wallet connection, signature, approval, swap, RPC transaction, or real funds;
- unpacked directory `dist/tango-paper-trader`.

- [ ] **Step 2: Run the documentation test and confirm the failure**

Run:

```powershell
node --test tests/release-documentation.test.js
```

Expected: FAIL because onboarding, common-capital reset, deterministic no-chart valuation, and marker lifecycle are not yet fully documented.

- [ ] **Step 3: Update README and manual smoke coverage**

Document the implemented precedence and immutable execution behavior exactly. Add manual checks for all four GMGN button sizes in at least two trench columns, no-chart quick buy/detail trading, large fallback quantity, 100% sell, live mark upgrade, immediate marker creation, delayed/replaced iframe replay, disable clearing, install-vs-update onboarding, and all six independent balances.

The smoke test must explicitly say to click only Tango-labeled paper controls and never click GMGN buy/sell, wallet, approval, or signing UI.

- [ ] **Step 4: Run the complete automated gate**

Run:

```powershell
npm test
npm run check
```

Expected: both commands exit 0 with no failed tests or manifest/source validation errors.

- [ ] **Step 5: Build and inspect the unpacked extension**

Run:

```powershell
npm run build
npm test
Get-ChildItem -LiteralPath dist/tango-paper-trader
```

Expected: build exits 0, post-build tests exit 0, and `dist/tango-paper-trader` contains `manifest.json`, HTML entry points, README/PRIVACY, and the rebuilt `src` tree. Confirm `manifest.json` still represents exactly the six supported GMGN chains and does not add wallet/transaction permissions.

- [ ] **Step 6: Perform the paper-only manual smoke test**

Load `D:\web3\code_project\tango-paper-trade\dist\tango-paper-trader` as an unpacked Chrome extension. Use only Tango paper controls and verify the checklist in `docs/multichain-smoke-test.md`. Do not interact with any real-trading control. Record any browser-only discrepancy as a failing regression before changing source.

- [ ] **Step 7: Commit Task 7**

```powershell
git add README.md docs/multichain-smoke-test.md tests/release-documentation.test.js dist/tango-paper-trader
git commit -m "docs: document resilient GMGN paper trading"
```

---

## Final acceptance checklist

- [ ] All six chains pass quick buy, detail buy, partial sell, exact 100% sell, and chain-isolation tests.
- [ ] Every verified launchpad fixture has address-bound supply/initial-value coverage; unknown tokens use `$3,200 / 1B`.
- [ ] Trustworthy same-token GMGN/K-line prices immediately control marks, PnL, panel display, markers, sells, and later orders without rewriting executed quantity/cost.
- [ ] Four GMGN size modes and virtual DOM/slot/card replacements show exactly one correctly aligned paper button.
- [ ] Valid detail routes show usable paper controls without chart or token data.
- [ ] Post-trade markers publish immediately, replay to delayed/replaced frames, and clear immediately on disable.
- [ ] First install opens onboarding; updates do not; common capital initializes/resets all chains atomically after validation/confirmation.
- [ ] Active-chain balances, positions, transactions, PnL, and header assets remain independent and current-chain only.
- [ ] `npm test`, `npm run check`, `npm run build`, and the post-build `npm test` all pass.
- [ ] `dist/tango-paper-trader` is refreshed and is the documented Chrome load directory.
- [ ] No wallet, signing, approval, swap, RPC transaction, broadcast, or real-funds path was added or exercised.
