# GMGN Click-Time Detail Quote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute detail-page paper buys and sells from the newest trustworthy quote in the already verified GMGN detail DOM, with immediate exact-address fallback when that snapshot is unavailable.

**Architecture:** The GMGN adapter records the exact DOM nodes that passed its existing 48 ms double-read verification and exposes a synchronous, identity-bound snapshot fast path. The content runtime consults that fast path only at final detail-order commit, gives its factual dimensions order-local precedence, and otherwise preserves the existing local resolver and background refresh behavior.

**Tech Stack:** Chrome Extension Manifest V3, plain JavaScript, DOM APIs, Node.js `node:test`.

## Global Constraints

- No network request, timer, polling loop, WebSocket, or intentional wait may be added to the final order path.
- A DOM miss must preserve immediate no-K-line buy and sell fallback behavior.
- Trench quick buy must retain its immutable card click snapshot and must not invoke the detail snapshot reader.
- Chain and address identity use `chain:normalized-address`; route mismatches must never execute.
- Fee, slippage, PnL, supply, balance, position, and marker semantics remain unchanged.
- Do not call or dispatch events to GMGN native trade controls and do not add wallet, signing, approval, swap, RPC submission, or real-funds capabilities.
- The worktree contains pre-existing source and index changes. Preserve them, edit only named regions, and do not create a source commit that would absorb unrelated changes.

---

### Task 1: Add the verified synchronous GMGN detail snapshot

**Files:**
- Modify: `tests/gmgn-adapter.test.js:731-833, 5040-5285`
- Modify: `src/adapters/gmgn.js:17, 653-692, 2621-2652`

**Interfaces:**
- Consumes: Existing `readCurrentToken()`, `findTokenDetailScope(address, chain, allowUnknownChain)`, `detailTokenIdentity()`, `detailQuote()`, `hasTrustedChart()`, and `chartRouteKey()`.
- Produces: `Tango.GMGN.readVerifiedCurrentTokenSnapshot(expectedToken) -> { token, quote } | null`, synchronously and without side effects.

- [ ] **Step 1: Make the detail fixture support an in-place quote update**

Change `detailDocument()` so its `BaseInfoPriceView` reads mutable values while retaining the same `header`, `bar`, and quote-scope node objects:

```js
let currentQuote = { priceUsd, marketCapUsd, liquidityUsd, totalSupply };
const detailItems = () => infoItems || [
  { title: 'Price', value: currentQuote.priceUsd },
  { title: marketCapTitle, value: typeof currentQuote.marketCapUsd === 'number'
    ? `$${currentQuote.marketCapUsd}` : currentQuote.marketCapUsd },
  { title: 'Liquidity', value: currentQuote.liquidityUsd },
  { title: 'Total Supply', value: currentQuote.totalSupply }
];
const priceView = {
  querySelectorAll: () => detailItems().map(({ title, value }) => infoItem(title, value))
};
// Include this method on the returned fixture object.
setQuote(next) { currentQuote = { ...currentQuote, ...next }; }
```

- [ ] **Step 2: Write the failing verified-snapshot tests**

Add tests beside the existing detail trust tests:

```js
test('verified detail snapshot synchronously reads a newer quote from the same bound DOM nodes', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS, priceUsd: 3.75e-6,
    marketCapUsd: 3_750, liquidityUsd: 500, totalSupply: '1000000000'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  GMGN._clearChartTrust();
  try {
    markDetailChartReady(detail, 'base', EVM_ADDRESS);
    assert.equal((await GMGN.readCurrentToken()).quote.marketCapUsd, 3_750);
    detail.setQuote({ priceUsd: 4.3e-6, marketCapUsd: 4_300 });

    const snapshot = GMGN.readVerifiedCurrentTokenSnapshot({ chain: 'base', address: EVM_ADDRESS });

    assert.equal(snapshot.token.chain, 'base');
    assert.equal(snapshot.token.address, EVM_ADDRESS);
    assert.equal(snapshot.quote.priceUsd, 4.3e-6);
    assert.equal(snapshot.quote.marketCapUsd, 4_300);
    assert.equal(snapshot.quote.source, 'GMGN');
  } finally {
    GMGN._clearChartTrust();
    global.document = original.document;
    global.location = original.location;
  }
});

test('verified detail snapshot rejects a replaced DOM binding even with the same fingerprint', async () => {
  const original = { document: global.document, location: global.location };
  const first = detailDocument({ chain: 'base', address: EVM_ADDRESS, priceUsd: 2, marketCapUsd: 2_000, liquidityUsd: 500 });
  const replacement = detailDocument({ chain: 'base', address: EVM_ADDRESS, priceUsd: 9, marketCapUsd: 9_000, liquidityUsd: 500 });
  global.document = first.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}`, origin: 'https://gmgn.ai' };
  GMGN._clearChartTrust();
  try {
    markDetailChartReady(first, 'base', EVM_ADDRESS);
    await GMGN.readCurrentToken();
    global.document = replacement.document;
    markDetailChartReady(replacement, 'base', EVM_ADDRESS);
    assert.equal(GMGN.readVerifiedCurrentTokenSnapshot({ chain: 'base', address: EVM_ADDRESS }), null);
  } finally {
    GMGN._clearChartTrust();
    global.document = original.document;
    global.location = original.location;
  }
});
```

Add one table-driven rejection test covering an expected-token address mismatch, cross-chain same address, cleared chart trust, and a linkless/non-chain-bound detail scope. Every case must return `null`.

- [ ] **Step 3: Run the adapter tests and verify RED**

Run:

```powershell
node --test tests/gmgn-adapter.test.js
```

Expected: FAIL because `GMGN.readVerifiedCurrentTokenSnapshot` is not defined; existing tests remain otherwise green.

- [ ] **Step 4: Store the verified DOM binding after the existing double-read succeeds**

Extend `lastVerifiedDetail` at the existing successful assignment:

```js
lastVerifiedDetail = {
  chain,
  address,
  routeKey: chartRouteKey(chain, address),
  fingerprint,
  chainBound: confirmed.chainBound === true,
  header: confirmed.header,
  identityScope: confirmed.identityScope,
  bindingScope: confirmed.bindingScope,
  quoteScope: confirmed.quoteScope
};
```

Do not change the 48 ms wait, route recheck, placeholder behavior, or cross-chain fingerprint guard in `readCurrentToken()`.

- [ ] **Step 5: Implement the synchronous snapshot reader**

Add the following behavior beside `readCurrentToken()` and export it as a public adapter method:

```js
function readVerifiedCurrentTokenSnapshot(expectedToken) {
  if (!isTokenDetailPage()) return null;
  const chain = chainFromUrl();
  const rawAddress = tokenAddressFromUrl();
  const expectedAddress = expectedToken?.address || expectedToken?.tokenAddress;
  if (!chain || expectedToken?.chain !== chain
    || !Tango.Chains.validateAddress(chain, rawAddress)
    || !Tango.Chains.validateAddress(chain, expectedAddress)) return null;
  const address = Tango.Chains.normalizeAddress(chain, rawAddress);
  if (Tango.Chains.normalizeAddress(chain, expectedAddress) !== address) return null;

  const verified = lastVerifiedDetail;
  if (!verified || verified.chain !== chain || verified.address !== address
    || verified.routeKey !== chartRouteKey(chain, address) || verified.chainBound !== true
    || !hasTrustedChart(chain, address)) return null;

  const detail = findTokenDetailScope(address, chain, false);
  if (!detail || detail.chainBound !== true) return null;
  for (const key of ['header', 'identityScope', 'bindingScope', 'quoteScope']) {
    if (!verified[key] || detail[key] !== verified[key] || detail[key].isConnected === false) return null;
  }
  const identity = detailTokenIdentity(detail.identityScope || detail.scope, address, chain);
  const fingerprint = `${identity.symbol}\u0000${identity.name}\u0000${tokenLogo(detail.header)}`;
  if (fingerprint !== verified.fingerprint) return null;
  const quote = detailQuote(detail, chain, address);
  if (!(Number.isFinite(Number(quote?.priceUsd)) && Number(quote.priceUsd) > 0)
    || quote?.source !== 'GMGN' || quote?.priceProvenance !== 'OBSERVED_PRICE') return null;
  return {
    token: {
      chain, address, symbol: identity.symbol, name: identity.name, logoUrl: tokenLogo(detail.header),
      launchpad: quote.launchpad, launchMode: quote.launchMode,
      metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: { ...quote, chain, address }
  };
}
```

- [ ] **Step 6: Run the adapter tests and verify GREEN**

Run:

```powershell
node --test tests/gmgn-adapter.test.js
```

Expected: all adapter tests PASS with no new warning or unhandled rejection.

- [ ] **Step 7: Inspect the task diff without changing the existing index**

Run:

```powershell
git diff --check -- src/adapters/gmgn.js tests/gmgn-adapter.test.js
git diff -- src/adapters/gmgn.js tests/gmgn-adapter.test.js
```

Expected: only the verified-binding record, synchronous reader/export, mutable fixture, and named tests are new relative to the pre-task worktree.

---

### Task 2: Prefer the verified detail snapshot only at final paper-order commit

**Files:**
- Modify: `tests/content-runtime.test.js:287-525, 5085-5555`
- Modify: `tests/content-structure.test.js:124-145`
- Modify: `src/content/content.js:1108-1160, 1598-1682`

**Interfaces:**
- Consumes: `Tango.GMGN.readVerifiedCurrentTokenSnapshot(expectedToken)` from Task 1 and existing `resolvePaperTradeQuote()` / `paperExecutableQuote()`.
- Produces: `resolveCommitPaperTradeQuote(order, position, routeCapture) -> quote | null`, synchronously.

- [ ] **Step 1: Extend the content-runtime fixture with a synchronous reader seam**

Add `readVerifiedCurrentTokenSnapshot` to `loadContent()` options, add `calls.readVerifiedCurrentTokenSnapshot`, and expose this non-async GMGN fixture method:

```js
readVerifiedCurrentTokenSnapshot(token) {
  calls.readVerifiedCurrentTokenSnapshot += 1;
  return readVerifiedCurrentTokenSnapshot ? readVerifiedCurrentTokenSnapshot(token) : null;
},
_isTokenDetailPage: () => {
  const parts = new URL(context.location.href).pathname.split('/').filter(Boolean);
  return parts[1] === 'token' && Boolean(context.Tango.Chains.get(parts[0]));
},
```

- [ ] **Step 2: Write failing final-commit quote tests**

Add a helper that creates an ETH detail context and held position with a cached `$3.75K` quote, then add:

```js
test('detail sell commits the verified synchronous DOM quote instead of the cached quote', async () => {
  let loaded;
  loaded = loadContent({
    readVerifiedCurrentTokenSnapshot: () => ({
      token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
      quote: {
        chain: 'eth', address: ADDRESS_A,
        priceUsd: 4_300 / 1_000_000_000, marketCapUsd: 4_300,
        observedAt: loaded.clock.now, priceObservedAt: loaded.clock.now,
        marketCapObservedAt: loaded.clock.now,
        source: 'GMGN', priceSource: 'GMGN', marketCapSource: 'GMGN',
        valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
      }
    })
  });
  seedHeldDetailPosition(loaded, 3_750);

  await loaded.api.sell(100);

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 1);
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 4_300);
  assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, 4_300 / 1_000_000_000);
});

test('detail commit immediately falls back when the verified DOM snapshot is unavailable', async () => {
  const loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => null });
  seedHeldDetailPosition(loaded, 3_750);

  const action = loaded.api.sell(100);

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 1);
  assert.equal(loaded.calls.sell, 1);
  await action;
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 3_750);
});
```

Add parallel coverage for:

- Detail buy choosing a `$4.30K` final snapshot.
- Confirmation preview at `$3.75K`, then confirmation snapshot at `$4.30K`.
- A cache field timestamp one millisecond newer than the snapshot still not overriding the order-local verified DOM price/market cap.
- Returned DOM identity mismatch being ignored.
- Trench `handleQuickBuy()` leaving the reader call count at zero and preserving its card market cap.

- [ ] **Step 3: Tighten the static immediate-execution assertion**

Extend the existing content-structure test so the final commit helper cannot gain blocking work:

```js
const commitQuote = between('function resolveCommitPaperTradeQuote(', 'function previewBuy(');
assert.doesNotMatch(commitQuote, /await|setTimeout|requestWithTimeout|sharedQuoteRequest|waitForGmgnQuote|sendMessage/);
assert.match(commitQuote, /readVerifiedCurrentTokenSnapshot/);
```

- [ ] **Step 4: Run the content tests and verify RED**

Run:

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: the detail-order tests FAIL because final commit still uses `order.quote`; the pre-existing tests otherwise pass.

- [ ] **Step 5: Add order-local candidate precedence to the existing resolver**

Keep the normal merge unchanged. When `options.preferCandidate === true`, overwrite only positive, trusted candidate dimensions after the normal merge:

```js
function preferObservationDimensions(merged, candidate) {
  if (!merged || !candidate) return merged;
  const preferred = { ...merged };
  for (const [valueField, timeField, sourceField] of [
    ['priceUsd', 'priceObservedAt', 'priceSource'],
    ['marketCapUsd', 'marketCapObservedAt', 'marketCapSource'],
    ['liquidityUsd', 'liquidityObservedAt', 'liquiditySource']
  ]) {
    if (!(Number.isFinite(Number(candidate[valueField])) && Number(candidate[valueField]) > 0)) continue;
    preferred[valueField] = Number(candidate[valueField]);
    preferred[timeField] = Number(candidate[timeField] || candidate.observedAt || 0);
    preferred[sourceField] = String(candidate[sourceField] || candidate.source || '');
  }
  if (Number.isFinite(Number(candidate.totalSupply)) && Number(candidate.totalSupply) > 0) {
    preferred.totalSupply = Number(candidate.totalSupply);
    preferred.totalSupplyObservedAt = Number(candidate.totalSupplyObservedAt || candidate.observedAt || 0);
    preferred.totalSupplySource = String(candidate.totalSupplySource || candidate.supplySource || '');
    preferred.totalSupplyObservationSource = String(candidate.totalSupplyObservationSource || candidate.source || '');
  }
  if (candidate.priceProvenance) preferred.priceProvenance = candidate.priceProvenance;
  preferred.observedAt = Number(candidate.observedAt || preferred.observedAt || 0);
  preferred.source = String(candidate.source || preferred.source || '');
  return preferred;
}
```

Apply it only to a previously identity-checked, fresh, trusted `boundCandidate`:

```js
const normallyMerged = freshExact && boundCandidate
  ? Tango.GMGNQuotes.mergeObservation(freshExact, boundCandidate)
  : boundCandidate || freshExact;
const merged = options.preferCandidate === true && boundCandidate
  ? preferObservationDimensions(normallyMerged, boundCandidate)
  : normallyMerged;
```

- [ ] **Step 6: Implement the synchronous final-commit selector**

Add a detail-route predicate and selector before `previewBuy()`:

```js
function routeMatchesDetailToken(token) {
  if (!Tango.GMGN._isTokenDetailPage?.()) return false;
  const chain = activeChain();
  if (!chain || token?.chain !== chain.id) return false;
  let routeAddress;
  try { routeAddress = Tango.GMGN.tokenAddressFromUrl(); } catch { return false; }
  const address = token?.address || token?.tokenAddress;
  return Tango.Chains.validateAddress(chain.id, address)
    && Tango.Chains.validateAddress(chain.id, routeAddress)
    && Tango.Chains.normalizeAddress(chain.id, address)
      === Tango.Chains.normalizeAddress(chain.id, routeAddress);
}

function resolveCommitPaperTradeQuote(order, position, routeCapture) {
  if (!routeCaptureIsCurrent(routeCapture)) return null;
  const fallback = resolvePaperTradeQuote(order?.token, order?.quote, { position });
  if (!routeMatchesDetailToken(order?.token)) return fallback;
  const snapshot = Tango.GMGN.readVerifiedCurrentTokenSnapshot?.(order.token);
  if (!routeCaptureIsCurrent(routeCapture)) return null;
  const address = snapshot?.token?.address || snapshot?.token?.tokenAddress;
  if (snapshot?.token?.chain !== order.token.chain
    || !Tango.Chains.validateAddress(order.token.chain, address)
    || Tango.Chains.normalizeAddress(order.token.chain, address)
      !== Tango.Chains.normalizeAddress(order.token.chain, order.token.address)) return fallback;
  return resolvePaperTradeQuote(order.token, snapshot.quote, { position, preferCandidate: true }) || fallback;
}
```

Do not call this selector from `handleQuickBuy()` or `buy()` preview construction.

- [ ] **Step 7: Use the selector inside the existing trade lock at final commit**

In `commitBuy()` and `commitSell()`, replace only the quote input:

```js
const finalQuote = resolveCommitPaperTradeQuote(order, null, routeCapture);
const quote = paperExecutableQuote(order.token, finalQuote);
```

```js
const position = persistedQuoteContext(order.token);
const finalQuote = resolveCommitPaperTradeQuote(order, position, routeCapture);
const quote = paperExecutableQuote(order.token, finalQuote, position);
```

Keep `runtime.tradePending = true` before the selector, existing route/chain guards, Store calls, marker publishing, sounds, toasts, and `finally` blocks unchanged.

- [ ] **Step 8: Run focused content and execution tests and verify GREEN**

Run:

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js tests/engine.test.js tests/markers.test.js
```

Expected: all tests PASS; detail orders use the final snapshot, quick buy remains unchanged, and marker/engine behavior remains green.

- [ ] **Step 9: Inspect the task diff without changing the existing index**

Run:

```powershell
git diff --check -- src/content/content.js tests/content-runtime.test.js tests/content-structure.test.js
git diff -- src/content/content.js tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: only the order-local merge helper, detail predicate/final selector, two commit call-site changes, fixture seam, and named regression tests are new relative to the pre-task worktree.

---

### Task 3: Verify the complete quote fix and regenerate the extension

**Files:**
- Regenerate: `dist/tango-paper-trader/**`
- Verify: `manifest.json`, `scripts/validate-extension.js`, all source and test files

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: A validated unpacked Chrome extension directory at `dist/tango-paper-trader`.

- [ ] **Step 1: Run the full automated suite**

Run:

```powershell
npm test
```

Expected: every test passes with zero failures, cancellations, or unhandled rejections.

- [ ] **Step 2: Run extension safety validation**

Run:

```powershell
npm run check
```

Expected: extension validation passes, permissions remain `['storage']`, and paper-only safety checks report no wallet or transaction path.

- [ ] **Step 3: Build the unpacked extension**

Run:

```powershell
npm run build
```

Expected: `dist/tango-paper-trader` is regenerated successfully from current source.

- [ ] **Step 4: Re-run validation against the built directory**

Run:

```powershell
npm run check
git diff --check
```

Expected: validation still passes and no whitespace errors are introduced.

- [ ] **Step 5: Review final scope and safety**

Run:

```powershell
git status --short
git diff --stat
```

Expected: the final report distinguishes pre-existing dirty-worktree changes from the files touched by this plan and identifies `dist/tango-paper-trader` as the Chrome “Load unpacked” directory.
