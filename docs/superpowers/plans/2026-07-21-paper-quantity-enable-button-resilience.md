# Paper Quantity, Re-enable, and Quick-Buy Size Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix multichain paper quantities and exact full closes, make OFF-to-ON activation immediate, and keep Tango quick-buy controls aligned with every GMGN custom button size.

**Architecture:** Extend the GMGN adapter to bind launchpad identity to the exact trench card and to emit a non-factual provisional 1B valuation only when stronger supply evidence is absent. Keep that provisional divisor out of trusted persisted supply, but carry it through the content quote resolver so the first local fill uses `marketCap / 1B`. Treat 100% as an exact engine close, make content re-enable an explicit lifecycle transition, and synchronize replacement geometry whenever GMGN resizes or reconciles its native control.

**Tech Stack:** Chrome MV3, dependency-free JavaScript, Node.js built-in test runner, DOM adapter harnesses, SHA-256 release verification.

## Global Constraints

- Paper execution must remain completely local and immediate.
- Do not add wallets, signatures, approvals, swap routes, RPC transaction calls, broadcasts, WebSocket trading transports, or any real-funds capability.
- Supply priority is GMGN exact > coherent market-cap/price ratio > verified launchpad rule > provisional 1B.
- Preserve the existing verified exceptions: Pump Mayhem 2B and Bankr/Clanker 100B.
- A provisional 1B divisor must not be persisted as `GMGN_EXACT`, `GMGN_RATIO`, `LAUNCHPAD_RULE`, or any other factual supply source.
- A later stronger observation must calibrate the paper quantity through the existing value-preserving audit path.
- A 100% sell must close the complete position with no floating quantity or cost dust.
- OFF-to-ON must work without page reload and must not register duplicate listeners, timers, or orders.
- Small, large, extra-large, and giant GMGN custom button sizes must update without reloading.
- Preserve unrelated user files and changes in the main checkout.

---

## File map

- `src/adapters/gmgn.js`: address-bound launchpad discovery, provisional trench valuation, and live quick-buy geometry.
- `src/content/content.js`: consume the provisional divisor without promoting it to trusted supply; perform immediate OFF-to-ON activation.
- `src/core/engine.js`: exact full-close arithmetic branch.
- `tests/gmgn-adapter.test.js`: launchpad binding, provisional 1B, and four-size geometry regressions.
- `tests/content-runtime.test.js`: provisional quote consumption and OFF-to-ON lifecycle regressions.
- `tests/engine.test.js`: calibrated fractional 100% close regression.
- `docs/superpowers/specs/2026-07-21-paper-quantity-enable-button-resilience-design.md`: approved behavioral source of truth.

### Task 1: Correct immediate multichain paper quantities

**Files:**
- Modify: `tests/gmgn-adapter.test.js:14-88, 521-618`
- Modify: `tests/content-runtime.test.js:20-320, 620-758`
- Modify: `src/adapters/gmgn.js:355-364, 537-545, 603-617, 803-815`
- Modify: `src/content/content.js:737-840`

**Interfaces:**
- Produces: `cardLaunchpad(card, address, chain)` returning a canonical launchpad name or `''`.
- Produces: quick-buy token metadata with `launchpad` and `launchMode` bound to the same card address.
- Produces: provisional card quote fields `{ provisionalSupply: 1_000_000_000, provisional: true, syntheticTokenPrice: true }` only for unknown-supply market-cap quotes.
- Consumes: `Tango.Supply.resolve({ chain, launchpad, launchMode, marketCapUsd, priceUsd })` without weakening its trusted source rules.

- [ ] **Step 1: Extend the adapter harness for address-bound launchpad links**

Add `launchpadHref` to `quickBuyHarness` and return it only from `card.querySelectorAll('a[href]')`. Keep the GMGN token href separate so tests can prove that a launchpad link belongs to the same card.

```js
function quickBuyHarness({
  chain = 'sol', address = PUMP_ADDRESS, marketCap = '$10K', launchpadHref = ''
} = {}) {
  // existing setup...
  const launchpadLink = launchpadHref ? { href: launchpadHref, getAttribute: () => launchpadHref } : null;
  card.querySelectorAll = (selector) => selector === 'a[href]' && launchpadLink ? [launchpadLink] : [];
}
```

- [ ] **Step 2: Write failing launchpad and provisional-quantity adapter tests**

Add table-driven cases proving:

```js
const cases = [
  ['bsc', 'https://four.meme/token/' + EVM_ADDRESS, 'Four.meme', 1_000_000_000],
  ['bsc', 'https://flap.sh/bnb/' + EVM_ADDRESS, 'Flap', 1_000_000_000],
  ['base', 'https://clanker.world/clanker/' + EVM_ADDRESS, 'Clanker', 100_000_000_000],
  ['xlayer', 'https://bow.fun/token/' + EVM_ADDRESS, 'Bow.fun', 1_000_000_000]
];
```

For each case, inject the button, invoke `slot.__tangoQuickBuyHandler()`, and assert:

```js
assert.equal(order.token.launchpad, expectedLaunchpad);
assert.equal(order.quote.totalSupply, expectedSupply);
assert.equal(order.quote.supplySource, 'LAUNCHPAD_RULE');
assert.equal(order.quote.priceUsd, order.quote.marketCapUsd / expectedSupply);
```

Add a mismatched-address launchpad link and assert it is ignored. Add an unknown-platform card with `$5K` market cap and assert:

```js
assert.equal(order.quote.priceUsd, 5_000 / 1_000_000_000);
assert.equal(order.quote.totalSupply, 0);
assert.equal(order.quote.supplySource, '');
assert.equal(order.quote.provisionalSupply, 1_000_000_000);
assert.equal(order.quote.syntheticTokenPrice, true);
assert.equal(order.quote.provisional, true);
```

- [ ] **Step 3: Run the adapter tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="launchpad|provisional 1B" tests/gmgn-adapter.test.js
```

Expected: FAIL because `verifiedCardMetadata` has no launchpad, BSC/Base/XLayer market-cap snapshots have no trusted supply, and unknown cards still emit price `0`.

- [ ] **Step 4: Implement address-bound launchpad discovery**

In `src/adapters/gmgn.js`, add a canonical host/path mapping and validate any exposed address against the active card:

```js
const CARD_LAUNCHPADS = Object.freeze([
  { pattern: /(?:^|\.)four\.meme$/i, name: 'Four.meme' },
  { pattern: /(?:^|\.)flap\.sh$/i, name: 'Flap' },
  { pattern: /(?:^|\.)pump\.fun$/i, name: 'Pump.fun' },
  { pattern: /(?:^|\.)zora\.co$/i, name: 'Zora' },
  { pattern: /bankr/i, name: 'Bankr' },
  { pattern: /clanker/i, name: 'Clanker' },
  { pattern: /(?:^|\.)dyor/i, name: 'DYOR' },
  { pattern: /(?:^|\.)bow\.fun$/i, name: 'Bow.fun' }
]);

function cardLaunchpad(card, address, chain) {
  for (const link of card?.querySelectorAll?.('a[href]') || []) {
    let parsed;
    try { parsed = new URL(link.href || link.getAttribute?.('href') || '', global.location?.origin); }
    catch { continue; }
    const match = CARD_LAUNCHPADS.find((entry) => entry.pattern.test(parsed.hostname));
    if (!match) continue;
    const exposed = [...parsed.pathname.split('/').filter(Boolean)].reverse()
      .find((part) => Tango.Chains.validateAddress(chain, decodeURIComponent(part)));
    if (exposed && Tango.Chains.normalizeAddress(chain, decodeURIComponent(exposed)) !== address) continue;
    return match.name;
  }
  return '';
}
```

Return `launchpad` and `launchMode: ''` from `verifiedCardMetadata`, and use those values when building both visible metadata and the quick-buy token.

- [ ] **Step 5: Implement the non-factual provisional 1B card valuation**

Keep trusted supply fields empty for the last-resort estimate:

```js
const supply = Tango.Supply?.resolve?.({
  chain, launchpad: token.launchpad, launchMode: token.launchMode,
  marketCapUsd, priceUsd: 0
}) || null;
const provisionalSupply = !supply && marketCapUsd > 0 ? 1_000_000_000 : 0;
const valuationSupply = Number(supply?.totalSupply || provisionalSupply || 0);
const priceUsd = valuationSupply > 0 ? marketCapUsd / valuationSupply : 0;

return {
  priceUsd, marketCapUsd, liquidityUsd: 0, nativePriceUsd: 0,
  totalSupply: Number(supply?.totalSupply || 0),
  supplySource: supply?.source || '',
  provisionalSupply,
  provisional: provisionalSupply > 0,
  syntheticTokenPrice: provisionalSupply > 0,
  valuationMode: supply ? 'MARKET_CAP' : 'PRICE',
  priceProvenance: provisionalSupply > 0 ? 'SYNTHETIC_PRICE'
    : (supply ? 'MARKET_CAP_DERIVED' : ''),
  source: 'GMGN_TRENCH', observedAt: marketCapUsd > 0 ? Date.now() : 0
};
```

Do not add `provisionalSupply` to the trusted state schema or trusted supply-source list.

- [ ] **Step 6: Write a failing content resolver test for the provisional divisor**

Call `resolvePaperTradeQuote` with a BSC card quote containing market cap and `provisionalSupply: 1_000_000_000`. Assert that the returned executable paper quote uses `marketCap / provisionalSupply`, stays synthetic/provisional, and does not claim a trusted supply:

```js
assert.equal(quote.priceUsd, 5_000 / 1_000_000_000);
assert.equal(quote.syntheticTokenPrice, true);
assert.equal(quote.provisional, true);
assert.equal(quote.totalSupply, 0);
assert.equal(quote.supplySource, '');
```

- [ ] **Step 7: Run the content test and verify RED**

Run:

```powershell
node --test --test-name-pattern="provisional 1B" tests/content-runtime.test.js
```

Expected: FAIL because the resolver currently discards every synthetic price and falls back to 1 USD.

- [ ] **Step 8: Consume the provisional divisor without promoting it**

In `resolvePaperTradeQuote`, validate the provisional divisor as exactly 1B, derive a separate provisional price, and use it only after stronger exact/rule/ratio price paths:

```js
const provisionalSupply = Number(local.provisionalSupply) === 1_000_000_000
  ? 1_000_000_000 : 0;
const provisionalPrice = !safeObservedPrice && !derivedPrice
  && safeMarketCapUsd > 0 && provisionalSupply > 0
  ? safeMarketCapUsd / provisionalSupply : 0;
const priceUsd = safeObservedPrice || derivedPrice || provisionalPrice || historicalPrice || 1;
const syntheticTokenPrice = !(safeObservedPrice > 0 || derivedPrice > 0 || historicalPrice > 0);
```

Return `totalSupply: 0` and `supplySource: ''` for that path. Preserve the existing GMGN exact, ratio, and launchpad priority.

- [ ] **Step 9: Verify quantity tests GREEN and run adjacent suites**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/supply.test.js tests/engine.test.js tests/state.test.js
```

Expected: all selected tests pass, including the existing exact > ratio > launchpad-rule tests.

- [ ] **Step 10: Commit the quantity fix**

```powershell
git add -- src/adapters/gmgn.js src/content/content.js tests/gmgn-adapter.test.js tests/content-runtime.test.js
git commit -m "fix: derive immediate multichain paper quantities"
```

### Task 2: Make 100% an exact full close

**Files:**
- Modify: `tests/engine.test.js:790-900, 1200-1330`
- Modify: `src/core/engine.js:646-746`

**Interfaces:**
- Consumes: existing `executeSell(state, order, settings, now)`.
- Produces: `percent === 100` semantics that use the exact stored quantity and cost basis.
- Preserves: guarded proportional arithmetic for every percentage below 100 and explicit-quantity orders.

- [ ] **Step 1: Write the calibrated-fraction full-close regression test**

Create a valid BSC paper position, then set the calibrated quantity to the known floating-point reproducer `123_456_789.12345679`. Preserve a positive cost basis and execute a 100% sell with a valid fresh quote:

```js
const key = Engine.positionKey('bsc', bscToken.address);
bought.positions[key].quantity = 123_456_789.12345679;
bought.positions[key].costBasisNative = 1;

const sold = Engine.executeSell(bought, {
  token: bscToken,
  quote: freshBscQuote,
  percent: 100
}, settings, 2_000);

assert.equal(sold.state.positions[key], undefined);
assert.equal(sold.trade.quantity, 123_456_789.12345679);
assert.equal(Number.isFinite(sold.trade.realizedPnlNative), true);
```

- [ ] **Step 2: Run the engine test and verify RED**

Run:

```powershell
node --test --test-name-pattern="calibrated fractional.*100%" tests/engine.test.js
```

Expected: FAIL with `invalidArithmetic` because `quantity * 100 / 100` leaves approximately `1.49e-8` quantity while the remaining cost rounds to zero.

- [ ] **Step 3: Implement an exact full-close branch**

In `executeSell`, separate full close from partial arithmetic:

```js
const percent = Number(order.percent || 0);
const fullClose = order.quantity == null && percent === 100;
const requestedQuantity = order.quantity == null
  ? (fullClose ? existingQuantity : checkedArithmetic(existingQuantity * percent / 100, 'positive'))
  : Number(order.quantity);
const quantity = fullClose ? existingQuantity : Math.min(existingQuantity, requestedQuantity);

const remainingQuantity = fullClose
  ? 0 : checkedArithmetic(Math.max(0, existingQuantity - quantity), 'nonnegative');
const costShareNative = fullClose
  ? existingCostBasisNative
  : checkedArithmetic(existingCostBasisNative * quantity / existingQuantity,
      existingCostBasisNative > 0 ? 'positive' : 'nonnegative');
const remainingCost = fullClose
  ? 0 : checkedArithmetic(Math.max(0, existingCostBasisNative - costShareNative),
      partialPositionWithCost ? 'positive' : 'nonnegative');
```

Delete the position when `fullClose` is true. Keep all proceeds, fee, PnL, timestamp, and state immutability checks unchanged.

- [ ] **Step 4: Verify full close GREEN and partial guards unchanged**

Run:

```powershell
node --test tests/engine.test.js tests/state-coordinator.test.js
```

Expected: all tests pass, including partial-sell underflow/overflow rejection tests.

- [ ] **Step 5: Commit the exact-close fix**

```powershell
git add -- src/core/engine.js tests/engine.test.js
git commit -m "fix: close paper positions exactly at 100 percent"
```

### Task 3: Activate all content features immediately after OFF-to-ON

**Files:**
- Modify: `tests/content-runtime.test.js:20-320`
- Modify: `src/content/content.js:331-373`

**Interfaces:**
- Consumes: the existing serialized `refresh`, `tickQuote`, `syncQuickBuyButtons`, route placeholder, and MAIN-world quote replay message.
- Produces: one explicit disabled-to-enabled activation cycle.
- Preserves: initial startup behavior and disable cleanup.

- [ ] **Step 1: Extend the content harness to observe refresh activation**

Expose `performRefresh` and `refresh` in `__contentTest`. Add injectable `getAll`, counters for `readCurrentToken` and `discoverTokenCards`, and capture the store subscriber:

```js
Store: {
  getAll: async () => getAll ? getAll() : { state: defaultState(), settings: defaultSettings() },
  subscribe(listener) { calls.storeSubscriber = listener; }
}
```

- [ ] **Step 2: Write the failing OFF-to-ON runtime test**

Start with `runtime.settings.enabled = false` on a valid detail route. Make the next authoritative `getAll()` return enabled settings, invoke `performRefresh()`, flush queued microtasks and the animation frame, and assert:

```js
assert.equal(loaded.api.runtime.settings.enabled, true);
assert.ok(loaded.api.runtime.current?.token);
assert.ok(loaded.calls.discoverTokenCards >= 1);
assert.equal(loaded.calls.readCurrentToken, 1);
assert.equal(loaded.pageMessages.filter((message) => message.type === 'REQUEST_QUOTES').length, 1);
assert.notEqual(loaded.shell.innerHTML, '');
```

Call `performRefresh()` again with enabled settings and assert quote replay is not duplicated as a lifecycle transition. Repeated idempotent discovery by the normal quote tick is allowed; duplicate controls, actions, listeners, timers, and orders are not.

- [ ] **Step 3: Run the content test and verify RED**

Run:

```powershell
node --test --test-name-pattern="OFF-to-ON|re-enable" tests/content-runtime.test.js
```

Expected: FAIL because current refresh only reloads state/settings and queues render.

- [ ] **Step 4: Implement the explicit activation transition**

After assigning authoritative state/settings in `performRefresh`, detect only the real transition:

```js
const becameEnabled = previousSettings?.enabled === false
  && runtime.settings.enabled === true
  && runtime.state.initialized === true;
```

For that transition:

```js
ensureRouteTokenContext();
syncSelectedChainFromRoute(captureRoute());
window.postMessage({ source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' }, '*');
syncQuickBuyButtons();
tickQuote();
```

Do not await `tickQuote()` from the settings callback; it is already coalesced and must not delay popup persistence or render. Keep the existing disable cleanup and final `queueRender()`.

- [ ] **Step 5: Verify activation GREEN and no regressions**

Run:

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js tests/storage.test.js tests/popup-runtime.test.js
```

Expected: all tests pass and no test observes duplicate intervals, subscriptions, quick-buy actions, or orders.

- [ ] **Step 6: Commit the activation fix**

```powershell
git add -- src/content/content.js tests/content-runtime.test.js tests/content-structure.test.js
git commit -m "fix: reactivate paper controls without reload"
```

### Task 4: Synchronize all GMGN custom quick-buy sizes

**Files:**
- Modify: `tests/gmgn-adapter.test.js:14-88, 774-836`
- Modify: `src/adapters/gmgn.js:620-624, 664-696, 751-834`

**Interfaces:**
- Produces: `syncQuickBuyGeometry(slot, nativeControl?)` that updates the replacement from current geometry.
- Consumes: existing `ResizeObserver`, tracked slot metadata, and any GMGN-reconciled native control.
- Preserves: restoration of the original native control when Tango is disabled.

- [ ] **Step 1: Make the adapter harness dimensions mutable**

Add mutable `slotRect` and `nativeRect`, expose setters, and expose the slot class set:

```js
let slotRect = { height: 24, width: 80 };
let nativeRect = { height: 24, width: 80 };
slot.getBoundingClientRect = () => ({ ...slotRect });
nativeControl.getBoundingClientRect = () => ({ ...nativeRect });
return {
  ...,
  classes,
  setSlotRect(rect) { slotRect = { ...slotRect, ...rect }; },
  setNativeRect(rect) { nativeRect = { ...nativeRect, ...rect }; }
};
```

- [ ] **Step 2: Write the failing four-size resize test**

Reload the adapter with a fake `ResizeObserver` that stores its callback. Inject one button, then feed four current slot geometries such as 24, 32, 40, and 48 pixels. After each callback assert the Tango button height matches the live size, narrow/expanded classes reflect the current geometry, and no second quick-buy action is created.

Also simulate GMGN reconciling a new native control with a changed height. Call discovery again and assert Tango copies its current geometry before removing it.

```js
for (const height of [24, 32, 40, 48]) {
  harness.setSlotRect({ height });
  resizeCallback([{ target: harness.slot }]);
  assert.equal(harness.replacement.style.height, `${height}px`);
}
assert.equal(orders.length, 0);
```

- [ ] **Step 3: Run the adapter resize test and verify RED**

Run:

```powershell
node --test --test-name-pattern="four GMGN sizes|reconciled native" tests/gmgn-adapter.test.js
```

Expected: FAIL because the replacement keeps the injection-time inline height and an already-injected slot simply removes reconciled native controls without refreshing geometry.

- [ ] **Step 4: Implement live geometry synchronization**

Replace the two-class helper with a geometry helper:

```js
function syncQuickBuyGeometry(slot, nativeControl = null) {
  const replacement = slot?.__tangoReplacementQuickBuy
    || slot?.querySelector?.('.tango-list-quick-buy');
  if (!slot || !replacement) return;
  const slotRect = slot.getBoundingClientRect();
  const nativeRect = nativeControl?.getBoundingClientRect?.() || {};
  const height = Number(nativeRect.height || slotRect.height || 0);
  const width = Number(nativeRect.width || slotRect.width || 0);
  if (height > 0) replacement.style.height = `${Math.max(22, Math.round(height))}px`;
  replacement.style.width = '100%';
  slot.classList.toggle('tango-quick-expanded', height >= 36);
  slot.classList.toggle('tango-quick-narrow', width > 0 && width <= 72);
}
```

Have `ResizeObserver` call this helper. During initial injection, store the replacement on the slot before calling the helper. In the already-injected fast path, call `syncQuickBuyGeometry(slot, nativeControl)` before removing a reconciled GMGN native control.

Change the injected style from a forced `min-width: 58px` to the live slot width:

```css
.BuyButton-continer.tango-native-buy-overridden {
  isolation: isolate;
  min-width: 0;
  position: relative !important;
}
```

Keep compact/narrow badge and amount overflow rules.

- [ ] **Step 5: Verify size handling GREEN and restoration intact**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: all tests pass, including detached-slot cleanup, capped incremental discovery, native-control restoration, and quick-buy latency tests.

- [ ] **Step 6: Commit the responsive-size fix**

```powershell
git add -- src/adapters/gmgn.js tests/gmgn-adapter.test.js
git commit -m "fix: track GMGN quick-buy button sizes"
```

### Task 5: Full verification, build, and Chrome directory update

**Files:**
- Generated: `dist/tango-paper-trader/**`
- Synchronize to: `D:/web3/code_project/tango-paper-trade/dist/tango-paper-trader/**`
- Do not modify: `D:/web3/code_project/tango-paper-trade/docs/superpowers/plans/2026-07-18-gmgn-multichain-paper-trading.md`

**Interfaces:**
- Consumes: complete source tree and build script.
- Produces: a verified unpacked Chrome extension identical to the tested source build.

- [ ] **Step 1: Run focused end-to-end paper regressions**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/engine.test.js tests/state.test.js tests/state-coordinator.test.js
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run the complete verification gate**

Run:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
git diff --check
```

Expected: all tests pass; extension validation reports version `0.3.0`; build reports `dist/tango-paper-trader`; diff check reports no whitespace errors.

- [ ] **Step 3: Verify all build files against source**

Run:

```powershell
$root = (Get-Location).Path
$distRoot = Join-Path $root 'dist\tango-paper-trader'
$sourceFiles = @('manifest.json','popup.html','dashboard.html','README.md','PRIVACY.md') +
  (Get-ChildItem (Join-Path $root 'src') -Recurse -File |
    ForEach-Object { $_.FullName.Substring($root.Length + 1) })
$mismatches = foreach ($relative in $sourceFiles) {
  $source = Join-Path $root $relative
  $built = Join-Path $distRoot $relative
  if (!(Test-Path -LiteralPath $built) -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash -ne
    (Get-FileHash -Algorithm SHA256 -LiteralPath $built).Hash) { $relative }
}
if ($mismatches) { throw "Build mismatch: $($mismatches -join ', ')" }
"Verified $($sourceFiles.Count)/$($sourceFiles.Count) packaged files"
```

Expected: `Verified 29/29 packaged files` unless the implementation intentionally adds another production file, in which case both numerator and denominator must match the new exact count.

- [ ] **Step 4: Review the final source diff and paper-only boundary**

Run:

```powershell
git status --short
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- src | Select-String -Pattern 'wallet|signature|sendTransaction|swap|approve|rpc|broadcast|WebSocket' -CaseSensitive:$false
```

Expected: only scoped adapter, content, engine, tests, and approved docs changed; no real-trade capability is introduced.

- [ ] **Step 5: Synchronize the generated extension directory safely**

Resolve and verify both absolute paths. Copy the 29 generated files from the feature worktree build to `D:/web3/code_project/tango-paper-trade/dist/tango-paper-trader`. Remove only target-only generated files after proving every resolved removal target is under that exact target directory. Do not copy source files into the main checkout.

- [ ] **Step 6: Verify source build and installed plugin hashes**

Compare every relative file in the feature build to the Chrome plugin directory with SHA-256. Assert zero missing, extra, or mismatched files and assert `src/core/supply.js` exists.

- [ ] **Step 7: Perform read-only Chrome smoke checks if available**

Without clicking any real-trade or wallet control, inspect supported GMGN trench/detail pages and verify:

- Four.meme/Flap cards expose the canonical launchpad to Tango.
- Tango button geometry follows the current custom button size.
- OFF-to-ON causes existing Tango UI to appear without page reload.

Do not simulate the buy/sell smoke step against GMGN real controls. Automated engine/content tests remain the authority for paper execution.

- [ ] **Step 8: Commit any final test-only corrections and report reload instructions**

If verification requires scoped corrections, repeat the relevant RED/GREEN cycle and commit only those files. Report the final commit IDs and instruct the user to click Reload for Tango on `chrome://extensions`, then refresh any already-open GMGN tabs only if Chrome itself has not re-injected the updated content script.
