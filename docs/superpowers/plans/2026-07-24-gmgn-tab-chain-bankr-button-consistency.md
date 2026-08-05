# GMGN Tab Chain, Robinhood Bankr, and Quick-Buy Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate cross-tab chain flicker, prevent GMGN field conflicts from corrupting launchpad-specific paper quantities, and make every dynamically inserted trench paper quick-buy button transparent and size-consistent.

**Architecture:** Route-derived chain state stays local to each GMGN tab, while Popup may use the active tab as a non-persistent view context and Dashboard changes only from explicit navigation or selection. A chain/platform/mode registry supplies explicit 1B, 2B, and 100B dimensions; GMGN fields receive semantic trust instead of traversal-order trust, and provisional dimension corrections preserve remaining paper value. Quick-buy presentation caching recognizes stable live Tailwind tokens while excluding transient card state.

**Tech Stack:** Manifest V3 Chrome extension, dependency-free browser JavaScript, Node.js built-in test runner, VM-based runtime harnesses, custom static validator/build scripts.

## Global Constraints

- Never invoke a GMGN native trade listener, wallet, signature, approval, swap, RPC broadcast, or any real-money path.
- Do not click any native or paper buy/sell control during browser validation.
- Paper orders remain immediate and deterministic when GMGN/K-line data is missing.
- Trusted GMGN/K-line price and exact supply continue to override fallback values.
- Preserve all existing staged and unstaged changes in the current `codex/gmgn-ui-safety` worktree.
- Do not commit, merge, push, switch branches, reset, or clean the worktree.
- Use `apply_patch` for source, test, documentation, and ledger edits.
- Observe every new regression test fail for the expected reason before changing its production code.

---

### Task 1: Make route chain tab-scoped and Popup active-tab aware

**Files:**
- Modify: `tests/content-runtime.test.js`
- Modify: `tests/popup-runtime.test.js`
- Modify: `src/content/content.js`
- Modify: `src/popup/popup.js`

**Interfaces:**
- Removes content ownership of `settings.selectedChain`.
- Produces `activeGmgnChain(): Promise<string>` inside Popup.
- Preserves `saveSelectedChain(chainId): Promise<Settings>` as the explicit persistence path.

- [ ] **Step 1: Add the failing content regression**

Replace route-persistence expectations with a regression that boots BSC and Robinhood content contexts against the same persisted settings and records all `Tango.Store.patchSettings` calls. Neither startup, refresh, nor route reconciliation may write `{ selectedChain: ... }`.

The core assertion is:

```js
assert.deepEqual(
  calls.settingsPatches.filter((patch) => Object.hasOwn(patch, 'selectedChain')),
  []
);
```

- [ ] **Step 2: Verify the content regression is red**

Run:

```powershell
node --test --test-name-pattern="route chain stays tab scoped|different-chain tabs" tests/content-runtime.test.js
```

Expected: FAIL because `syncSelectedChainFromRoute()` writes both route chains.

- [ ] **Step 3: Add failing Popup active-tab tests**

Extend `loadPopup()` with an `activeTabUrl` option and a `chrome.tabs.query()` stub. Cover:

```js
const popup = await loadPopup({
  activeTabUrl: 'https://gmgn.ai/?chain=robinhood'
});
assert.equal(popup.element('#popup-chain').value, 'robinhood');
assert.equal(popup.persistedSettings.selectedChain, 'eth');
assert.deepEqual(popup.calls.saves, []);
```

Also apply an unrelated storage update and assert the Popup remains on Robinhood, then explicitly select BSC and assert exactly one `{ selectedChain: 'bsc' }` write.

- [ ] **Step 4: Verify the Popup regression is red**

Run:

```powershell
node --test --test-name-pattern="active GMGN tab|view-only chain" tests/popup-runtime.test.js
```

Expected: FAIL because Popup only reads persisted `settings.selectedChain`.

- [ ] **Step 5: Remove route-to-global persistence**

Delete `runtime.selectedChainSync`, `runtime.selectedChainPersistence`, and `syncSelectedChainFromRoute()` from `src/content/content.js`. Remove all startup, refresh, and route-change calls to that function. Continue deriving the page chain from `activeChain()` and retain `runtime.activeChainId` only for local lifecycle invalidation.

- [ ] **Step 6: Implement Popup view-only active-tab context**

Add:

```js
let activeTabChain = '';

async function activeGmgnChain() {
  try {
    const [tab] = await global.chrome?.tabs?.query?.({ active: true, currentWindow: true }) || [];
    return Tango.Chains.fromUrl(tab?.url || '')?.id || '';
  } catch {
    return '';
  }
}
```

Resolve it once during Popup startup before the first render. When no explicit selector operation is pending, choose `activeTabChain || settings.selectedChain || 'sol'`. In `saveSelectedChain`, clear `activeTabChain` before rendering and persisting so an explicit user choice owns the remainder of that Popup session.

- [ ] **Step 7: Run focused chain-state tests**

Run:

```powershell
node --test tests/content-runtime.test.js tests/popup-runtime.test.js tests/dashboard-runtime.test.js
```

Expected: PASS with no selected-chain writes from content contexts and no Dashboard chain oscillation.

### Task 2: Preserve launchpad dimensions across GMGN quote upgrades

**Files:**
- Modify: `tests/supply.test.js`
- Modify: `tests/gmgn-quotes.test.js`
- Modify: `tests/content-runtime.test.js`
- Modify: `tests/engine.test.js`
- Modify: `tests/state.test.js`
- Modify: `src/core/supply.js`
- Modify: `src/adapters/gmgn-quotes.js`
- Modify: `src/content/content.js`
- Modify: `src/core/engine.js`
- Modify: `src/core/state.js`

**Interfaces:**
- `Tango.Supply.ruleSupply('robinhood', 'Bankr', '')` remains `100_000_000_000`.
- Known 1B, 2B, and 100B rules are explicit by chain/platform/mode; unknown remains 1B/$3,200.
- `GMGNQuotes.extract()` distinguishes explicit total supply from generic supply and rejects conflicting identities.
- Supply-only observations cannot become a newly derived live price by borrowing a historical fallback market cap.
- `Engine.calibratePosition()` neutralizes provisional supply/native dimensions only and records quantity before/after.

- [ ] **Step 1: Add the complete failing registry matrix**

Assert every explicit amount and controlled alias:

```js
assert.equal(Supply.ruleSupply('sol', 'Pump.fun', ''), 1_000_000_000);
assert.equal(Supply.ruleSupply('sol', 'Pump.fun', 'Mayhem'), 2_000_000_000);
assert.equal(Supply.ruleSupply('bsc', 'Four.meme', ''), 1_000_000_000);
assert.equal(Supply.ruleSupply('bsc', 'Flap', ''), 1_000_000_000);
assert.equal(Supply.ruleSupply('base', 'Zora Coins', ''), 1_000_000_000);
assert.equal(Supply.ruleSupply('xlayer', 'DYOR', ''), 1_000_000_000);
assert.equal(Supply.ruleSupply('xlayer', 'Bow.fun', ''), 1_000_000_000);
assert.equal(Supply.ruleSupply('base', 'Bankr.bot', ''), 100_000_000_000);
assert.equal(Supply.ruleSupply('robinhood', 'Banker', ''), 100_000_000_000);
assert.equal(Supply.ruleSupply('base', 'Clanker', ''), 100_000_000_000);
assert.equal(Supply.ruleSupply('robinhood', 'Clanker', ''), 100_000_000_000);
assert.equal(Supply.ruleSupply('eth', 'Unknown', ''), 0);
assert.equal(Supply.fallbackValuation({ chain: 'eth', launchpad: 'Unknown' }).totalSupply, 1_000_000_000);
```

- [ ] **Step 2: Add failing GMGN field-trust regressions**

Cover these payloads with the real extractor:

- one address with `total_supply: 100B` and a later nested `supply: 1B` retains 100B exact supply;
- generic `supply` alone never receives `GMGN_NETWORK_EXACT`;
- conflicting `address` and `token_address` produce no quote;
- conflicting equal-time explicit `total_supply` fragments produce no exact supply;
- explicit `price_usd` is accepted, while generic `price` without USD/coherence evidence is not.

- [ ] **Step 3: Verify registry/extractor regressions are red**

Run:

```powershell
node --test --test-name-pattern="launchpad matrix|Bankr aliases|conflicting supply|generic supply|conflicting address|generic price" tests/supply.test.js tests/gmgn-quotes.test.js
```

Expected: FAIL because aliases are incomplete and generic fields currently receive exact trust.

- [ ] **Step 4: Implement explicit registry aliases and semantic field extraction**

Keep the existing numeric rules, add controlled Bankr aliases (`bankr`, `bankrbot`, `banker`), and keep all platform records independent.

In `gmgn-quotes.js`, return field metadata from extraction rather than losing the matched key. Give explicit total supply higher trust than generic supply; do not emit generic supply as exact. Reject one object when its valid address aliases normalize to different identities. Prefer explicit USD price keys; generic price requires a coherent same-object market-cap and explicit-total-supply relationship.

- [ ] **Step 5: Add the failing no-cross-observation-price regression**

Start with a Robinhood Bankr position created from 100B/$3,200. Feed a supply-only GMGN observation. Assert the resolved executable quote retains the provisional price and 100B rule instead of deriving `$3,200 / 1B`.

```js
assert.equal(quote.totalSupply, 100_000_000_000);
assert.equal(quote.priceUsd, 3_200 / 100_000_000_000);
assert.equal(quote.syntheticTokenPrice, true);
```

- [ ] **Step 6: Verify the content regression is red**

Run:

```powershell
node --test --test-name-pattern="supply-only.*historical|Bankr.*3200" tests/content-runtime.test.js
```

Expected: FAIL because current content merges the new supply with historical market cap and derives a new price.

- [ ] **Step 7: Prevent cross-observation dimension mixing**

Track whether market cap and supply came from the same factual observation. A supply-only update may improve metadata but must not reuse `TANGO_POSITION_HISTORY` market cap to derive a factual price. Preserve the existing provisional execution quote until a same-token factual price or same-observation coherent market cap arrives.

- [ ] **Step 8: Add failing dimension-neutral calibration tests**

Cover:

- a fallback supply correction preserves the remaining position's native value and changes only remaining quantity;
- a provisional native-price correction does the same;
- original BUY and prior SELL records remain byte-equivalent;
- calibration audit records different `quantityBefore` and `quantityAfter`;
- a later real token-price change is not neutralized and produces normal PnL;
- partial sells calibrate only the remaining position.

- [ ] **Step 9: Verify calibration regressions are red**

Run:

```powershell
node --test --test-name-pattern="dimension correction|remaining quantity|later factual price" tests/engine.test.js tests/state.test.js
```

Expected: FAIL because current calibration keeps quantity unchanged for every correction.

- [ ] **Step 10: Implement dimension-scoped neutral calibration**

When `supplyCorrection` or `nativeCorrection` changes a provisional dimension, compute the corrected remaining quantity from the pre-correction native mark:

```js
const preservedValueNative = Engine.markPosition(existing).valueNative;
const nextQuantity = preservedValueNative * newNativePriceUsd / newPriceUsd;
```

Update remaining `quantity`, `averageEntryPriceUsd`, and coherent market-cap entry metadata, but do not modify historical trades or realized PnL. Do not neutralize a price-only correction against the intentional 3,200 USD entry snapshot. Record the before/after quantity in the existing calibration event.

- [ ] **Step 11: Add the complete Bankr economic regression**

With zero fees for exact arithmetic:

1. Buy 6 ETH at Robinhood Bankr 100B/$3,200 and assert 375B tokens.
2. Inject the conflicting nested generic 1B payload and assert it cannot calibrate the position.
3. Sell 100% at the unchanged 3,200 USD market cap and assert proceeds=6 ETH, PnL=0, account=10 ETH.

- [ ] **Step 12: Verify focused quote and engine behavior**

Run:

```powershell
node --test tests/supply.test.js tests/gmgn-quotes.test.js tests/content-runtime.test.js tests/engine.test.js tests/state.test.js
```

Expected: PASS.

### Task 3: Share stable live GMGN quick-buy presentation

**Files:**
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `tests/content-structure.test.js`
- Modify: `src/adapters/gmgn.js`
- Modify: `src/content/content.css`

**Interfaces:**
- `sharedQuickBuyPresentation(presentation)` recognizes stable live Tailwind geometry and transparent-background classes.
- `mergeQuickBuyPresentation(local, shared)` replaces stale geometry tokens without sharing transient card state.
- `tango-quick-buy-fallback` supplies safe layout only, never a solid background.

- [ ] **Step 1: Add a failing live-class dynamic-card test**

Use a connected source card whose native class bundle resembles production:

```js
const liveClasses = [
  'inline-flex', 'items-center', 'justify-center',
  '!h-[24px]', '!px-[6px]', '!leading-[12px]', '!text-[12px]',
  '!rounded-[4px]', '!bg-transparent'
].join(' ');
```

Insert a coherent same-column card whose native leaf is disconnected. Assert its paper replacement:

- contains the live dimension and `!bg-transparent` tokens;
- does not inherit loading, disabled, opacity, pointer, gradient, or inline background state;
- remains an inert Tango-created button;
- updates when the source changes to another real size bundle.

- [ ] **Step 2: Add a failing fallback CSS contract test**

Assert the fallback rule does not set the theme color or any solid background:

```js
assert.doesNotMatch(fallbackRule, /customize-button-ultra-color/);
assert.match(fallbackRule, /background:\s*transparent/);
assert.doesNotMatch(fallbackRule, /color:\s*#07110e/);
```

- [ ] **Step 3: Verify quick-buy regressions are red**

Run:

```powershell
node --test --test-name-pattern="live Tailwind|leafless|fallback.*transparent" tests/gmgn-adapter.test.js tests/content-structure.test.js
```

Expected: FAIL because the shared cache only recognizes synthetic `gmgn-*` size classes and fallback CSS is solid.

- [ ] **Step 4: Implement stable-class extraction**

Create one predicate for shareable presentation tokens. Accept only stable layout/geometry and transparent-normal-state tokens, including:

- `inline-flex`, `flex`, `items-center`, `justify-center`;
- bracketed height/width/min/max dimensions;
- bracketed padding, gap, font-size, and line-height dimensions;
- radius tokens;
- `bg-transparent`, `!bg-transparent`, and transparent border tokens.

Reject opacity, cursor, pointer-events, animation, loading, disabled, color fills, gradients, shadows, and all inline styles. Use the same predicate to remove old shared tokens in `mergeQuickBuyPresentation` before adding the current shared contract.

- [ ] **Step 5: Make fallback layout transparent**

Keep fallback alignment, slot filling, overflow, and minimum usability. Set transparent background/border and inherited color. Do not loosen any native-button safety selector or replace the native-removal strategy with an overlay.

- [ ] **Step 6: Run focused adapter and structure tests**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-structure.test.js tests/content-runtime.test.js
```

Expected: PASS.

### Task 4: Review, verify, build, and synchronize the Chrome package

**Files:**
- Generate: `dist/tango-paper-trader/**`
- Update: `.superpowers/sdd/progress.md`

**Interfaces:**
- Produces a loadable package whose generated source files match `src` byte-for-byte.

- [ ] **Step 1: Review each task**

For each task, inspect the task-specific diff and test report for both specification compliance and code quality. Resolve every Critical or Important finding and re-run the covering tests.

- [ ] **Step 2: Run the complete test suite**

Run:

```powershell
npm.cmd test
```

Expected: all tests PASS with zero failures, cancellations, or skipped regressions.

- [ ] **Step 3: Run the real-funds static safety gate**

Run:

```powershell
npm.cmd run check
```

Expected: validation PASS and no wallet, signature, approval, swap, RPC broadcast, or native trade capability.

- [ ] **Step 4: Build the extension**

Run:

```powershell
npm.cmd run build
```

Expected: `dist/tango-paper-trader` is regenerated successfully.

- [ ] **Step 5: Compare source and package hashes**

For every generated file mapped from `manifest.json`, `src/**`, and extension HTML, compare SHA-256 between the worktree source and `dist/tango-paper-trader`. Require zero missing files and zero mismatches.

- [ ] **Step 6: Re-run the release gates after build**

Run:

```powershell
npm.cmd test
npm.cmd run check
```

Expected: both commands PASS against the exact packaged source state.

- [ ] **Step 7: Preserve branch state**

Report the Chrome loading directory and changed files. Do not commit, merge, push, reset, clean, or remove the worktree.
