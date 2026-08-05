# GMGN Accurate First-Frame Paper Quick-Buy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept a newly created GMGN trench token's paper quick-buy immediately and safely, keep the paper control readable and clickable at every GMGN size, and preserve deterministic no-K-line paper execution.

**Architecture:** Add a synchronous, root-bounded mutation lane that can publish a paper control in the same observer turn. Only TokenItem roots actually delivered through `addedNodes` receive a WeakMap birth certificate, and only that certificate's first unique same-chain href may promote a coalesced 300 ms in-memory intent. Keep price, supply, and native-price fallback in the existing paper quote resolver; the Engine, persisted state, trade history, positions, and chart-marker schemas remain unchanged.

**Tech Stack:** Chrome Manifest V3, isolated-world and MAIN-world content scripts, plain JavaScript, CSS, Node.js built-in test runner, PowerShell release verification.

## Global Constraints

- Never click, dispatch, or call a GMGN native buy/sell control.
- Never open a wallet, request a signature or approval, submit a swap, broadcast an RPC transaction, or add a real-funds capability.
- One permitted activation produces exactly one Tango paper callback and zero native capture/bubble callbacks.
- The intent TTL is exactly 300 ms: evidence at `createdAt + 300` is eligible; evidence at `createdAt + 301` is not.
- Only a TokenItem root observed through `MutationRecord.addedNodes` can receive a birth certificate. Attribute-only hydration of a pre-existing virtual row cannot auto-consume an addressless click.
- Do not create provisional positions, pending trades, reserved balances, temporary addresses, mutable BUY/SELL history, or pending chart markers.
- Preserve chain-local balances, positions, Dashboard/PnL filtering, onboarding, shortcut synchronization, detail trading, marker replay, supply calibration, and OFF/ON behavior.
- Missing K-line, token price, market cap, supply, native price, symbol, image, or launchpad metadata cannot block a valid-address paper order.
- Fallback market cap is exactly 3,200 USD. Supply precedence is GMGN exact, a coherent same-observation GMGN price/market-cap ratio, verified launchpad rule, then unknown 1B. A synthetic/fallback dimension can never participate in the ratio. Synthetic paper native price is 1 USD.
- Pump.fun standard is 1B; Pump.fun Mayhem is 2B; Bankr/Banker/Bankr.bot/Clanker on Base and Robinhood is 100B; Four.meme/Flap/Zora/DYOR/Bow and unknown are 1B.
- Preserve all staged and unstaged work. Do not stage, commit, reset, clean, stash, switch branches, or overwrite unrelated work.
- Source files are authoritative. Build `dist/tango-paper-trader` only after all source tests and validators pass.

## Current Verified Baseline

- `node --test tests/native-quick-buy-guard.test.js tests/page-main.test.js tests/gmgn-quick-buy-world-integration.test.js tests/gmgn-adapter.test.js tests/content-runtime.test.js`: 317/317 pass.
- `node --test tests/gmgn-quotes.test.js tests/supply.test.js tests/engine.test.js tests/state.test.js`: 169/169 pass.
- `npm.cmd test`: 692/692 pass; `npm.cmd run check`: `Manifest 0.3.0 valid; 22 referenced files found.`
- The current source/package hash gate is intentionally RED before implementation: four packaged safety files lag their source counterparts.
- Task 1 from `2026-08-01-gmgn-always-clickable-paper-quick-buy.md` is complete and remains authoritative for Guard/MAIN cross-world safety.
- This plan supersedes only the earlier 2,000 ms addressless claim and the deferred-only mutation discovery. It completes the still-unfinished owned-layout task and retains the quote/supply behavior as regression-locked code.

---

### Task 1: Synchronous root-bounded discovery and card births

**Files:**
- Modify: `src/content/content.js:509-548, 2181-2219`
- Modify: `src/adapters/gmgn.js:1-20, 680-712, 1766-1832, 2005-2216`
- Modify: `tests/content-runtime.test.js:2028-2059, 2217-2324`
- Modify: `tests/gmgn-adapter.test.js:164-409, 4274-4401, 5030-5260`

**Interfaces:**
- Consumes: the current atomic `commitPaperQuickBuy`, Guard trust, and incremental `roots` argument.
- Produces:

```js
const TOKEN_ITEM_ROOT_SELECTOR =
  '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]';
const FAST_QUICK_BUY_SLOT_LIMIT = 24;

syncQuickBuyButtons(roots, {
  fast: boolean,
  addedRoots: Element[],
  policyKey: string
} = {}): void

Tango.GMGN.discoverTokenCards(
  onQuickBuy, amountNative, paperLabel, roots,
  { fast: boolean, addedRoots: Element[], policyKey: string } = {}
): number

recordQuickBuyCardBirths(addedRoots, chain, now = Date.now()): CardBirth[]

// test-only read seam; production logic continues to use the WeakMap directly
Tango.GMGN._quickBuyBirthForRoot(root): CardBirth | null

CardBirth = {
  card: Element,
  slot: Element,
  root: Element,
  generation: number,
  chain: string,
  bornAt: number,
  firstAddressHref: string,
  eligible: boolean
}
```

- [ ] **Step 1: Add RED runtime tests for the two mutation lanes**

Replace the old deferred-only expectation with explicit fast and maintenance calls:

```js
test('new TokenItem roots enter quick-buy discovery in the same mutation turn', async () => {
  const { loaded, observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot({ address: ADDRESS_A });
  const beforeTimers = timers.length;

  observerCallback([{
    type: 'childList', target: loaded.context.document.body,
    addedNodes: [card], removedNodes: []
  }]);

  assert.equal(discoveries.length, 1);
  assert.deepEqual(discoveries[0].roots, [card]);
  assert.equal(discoveries[0].options.fast, true);
  assert.deepEqual(discoveries[0].options.addedRoots, [card]);
  assert.equal(timers.length, beforeTimers + 1);

  timers[beforeTimers]();
  assert.equal(discoveries.length, 2);
  assert.equal(discoveries[1].options.fast, false);
});
```

Add a second test whose added TokenItem has no href. Before advancing the 160 ms timer, it must expose one connected `resolving-identity` paper action with `disabled === false`, a non-empty action ID and nonce, and a disconnected native control.

- [ ] **Step 2: Add RED adapter tests for birth eligibility**

Extend `quickBuyHarness` so its card matches the exact TokenItem selector and expose an `addedRoots` option. Assert:

```js
test('only an actually added TokenItem root receives an addressless auto-claim birth', () => {
  const fresh = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  const old = quickBuyHarness({ chain: 'base', address: '', tokenItem: true });
  withQuickBuyGlobals(fresh, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [fresh.card], {
      fast: true, addedRoots: [fresh.card]
    });
    assert.equal(GMGN._quickBuyBirthForRoot(fresh.card)?.eligible, true);
  });
  withQuickBuyGlobals(old, () => {
    GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [old.identityNode], {
      fast: true, addedRoots: []
    });
    assert.equal(GMGN._quickBuyBirthForRoot(old.card), null);
  });
});
```

Also assert that a detached/reinserted already-seen root, a root with two conflicting same-chain token addresses, and a root whose initial valid href is removed cannot retain an eligible birth.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="same mutation turn|actually added TokenItem|addressless auto-claim birth" tests/content-runtime.test.js tests/gmgn-adapter.test.js
```

Expected: runtime discovery remains behind the 160 ms timer and the adapter has no birth registry.

- [ ] **Step 4: Implement the fast mutation lane without a document scan**

In the observer callback, collect two arrays before queueing deferred maintenance:

```js
const fastRoots = [];
const addedRoots = [];
for (const record of records) {
  const target = record.target?.nodeType === 3
    ? record.target.parentElement : record.target;
  if (target?.nodeType === 1) fastRoots.push(target);
  for (const node of record.addedNodes || []) {
    if (node?.nodeType !== 1) continue;
    fastRoots.push(node);
    addedRoots.push(node);
  }
}
if (fastRoots.length && runtime.settings?.enabled
  && runtime.state?.initialized && runtime.settings?.showListQuickBuy
  && !runtime.quickBuySettingsPending && !runtime.quickBuyAuthoritativelyDisabled) {
  syncQuickBuyButtons([...new Set(fastRoots)], {
    fast: true, addedRoots: [...new Set(addedRoots)],
    policyKey: quickBuyPolicyKey()
  });
}
```

`quickBuyPolicyKey()` serializes the authoritative enabled, initialized, list-quick-buy, active-chain, first-preset, and paper-label values. Keep the existing 160 ms timer for `pendingMutationRoots`, header work, quote reads, broad reconciliation, presentation repair, cleanup, and marker replay. Its call must be `syncQuickBuyButtons(roots, { fast: false, addedRoots: [], policyKey: quickBuyPolicyKey() })`.

- [ ] **Step 5: Implement the WeakMap birth registry**

At adapter scope add:

```js
let quickBuyCardBirths = new WeakMap();
let quickBuySeenTokenRoots = new WeakSet();
```

`recordQuickBuyCardBirths` may inspect only an added root itself and TokenItem descendants:

```js
function tokenItemRootsInAddedNode(node) {
  const found = [];
  if (node?.matches?.(TOKEN_ITEM_ROOT_SELECTOR)) found.push(node);
  node?.querySelectorAll?.(TOKEN_ITEM_ROOT_SELECTOR)
    .forEach((root) => found.push(root));
  return [...new Set(found)];
}
```

For each never-seen root, resolve exactly one connected card and its `.BuyButton-continer`; create a record whose `generation` is `cardGeneration(card)`. Set `firstAddressHref` to the unique valid same-chain href already present, or `''`. Set `eligible` only when the root/card/slot are connected, identity is unambiguous, and no href removal/rewrite has occurred. A previously seen root never receives a second certificate merely because React detached and re-added the same DOM node.

Fast discovery slices its slot list to `FAST_QUICK_BUY_SLOT_LIMIT`; every root still remains in deferred maintenance so overflow is not lost.

- [ ] **Step 6: Attach exact births to resolving bindings**

`createPendingQuickBuy` receives the matching birth from the current discovery call and stores it as `binding.birth`. A binding without an exact `{card, slot, root, generation, chain}` match remains clickable but is not eligible for automatic intent completion.

Invalidate the birth when root/card/slot disconnect, the binding generation changes, route chain changes, amount changes, the first href is removed or rewritten, or conflicting valid addresses appear. `clearQuickBuy` replaces `quickBuyCardBirths` with a new WeakMap and clears all intents; it must not restore native UI unless the existing explicit-OFF path requests restoration.

- [ ] **Step 7: Re-run Task 1 tests and existing safety tests**

Run:

```powershell
node --test tests/content-runtime.test.js tests/gmgn-adapter.test.js tests/native-quick-buy-guard.test.js tests/page-main.test.js tests/gmgn-quick-buy-world-integration.test.js
```

Expected: address-known and addressless new cards publish in the observer callback, deferred maintenance still batches, and every native callback counter remains zero.

---

### Task 2: Exact 300 ms intent acceptance and atomic promotion

**Files:**
- Modify: `src/adapters/gmgn.js:29-58, 1210-1417, 1600-1769, 1878-1923, 2005-2216`
- Modify: `tests/gmgn-adapter.test.js:353-500, 4201-4415`
- Modify: `tests/gmgn-quick-buy-world-integration.test.js`

**Interfaces:**
- Consumes: Task 1 `CardBirth`, current Guard registration, binding nonce/generation, and `cardAddressEvidence`.
- Produces:

```js
const QUICK_BUY_IDENTITY_INTENT_TTL_MS = 300;

acceptQuickBuyIdentityActivation(binding, context, now = Date.now())
  -> { status: 'PROMOTED' | 'RECORDED' | 'REJECTED', intent?: QuickBuyIntent }

context = {
  onQuickBuy: Function,
  chainDefinition: object,
  paperLabel: string,
  policyKey: string
}

QuickBuyIntent = {
  slot, card, root, birth,
  generation, actionId, bindingNonce,
  chain, amountNative, paperLabel, policyKey, routeHref,
  createdAt, expiresAt
}
```

- [ ] **Step 1: Add RED boundary and same-click tests**

Replace the old 1,999 ms case and add both exact boundaries:

```js
for (const [elapsed, expectedOrders] of [[300, 1], [301, 0]]) {
  test(`first birth href at ${elapsed} ms auto-executes ${expectedOrders} order`, async () => {
    const scenario = addresslessIntentScenario(`ttl-${elapsed}`, { born: true });
    await scenario.run(async () => {
      await scenario.clickTwentyTimes();
      scenario.clock.now = 1_000 + elapsed;
      scenario.exposeApprovedHref();
      await scenario.reconcileFastHrefMutation();
      assert.equal(scenario.orders.length, expectedOrders);
    });
  });
}

test('an href appearing immediately before resolving dispatch consumes that same click once', async () => {
  const scenario = addresslessIntentScenario('same-click', { born: true });
  await scenario.run(async () => {
    scenario.exposeApprovedHref();
    await scenario.clickTwentyTimes();
    await scenario.flushPaperActions();
    assert.equal(scenario.orders.length, 1);
  });
});
```

- [ ] **Step 2: Add RED fail-closed drift matrix**

For each of `card`, `slot`, `root`, `generation`, `nonce`, `chain`, `amount`, `route`, `settings`, `disconnect`, `conflicting-href`, `href-removed`, `href-rewritten`, and `pre-existing-attribute-hydration`, create a born addressless card, click once, apply exactly that drift, expose a legal href, and reconcile. Assert zero orders, unchanged cash/positions/trades/markers, zero native callbacks, and either a new ordinary `ready` control or a safe resolving control.

Add a registration-failure case: promotion failure restores the exact resolving publication and may retry only while the original intent has remaining TTL. No unpublished successor may receive pointer events.

Extend `gmgn-quick-buy-world-integration.test.js` so MAIN-world `postMessage` reaches the isolated adapter action map and its real `onQuickBuy` spy. Cover resolving publication, same-click promotion, 300/301 ms completion, React ancestor replacement, Guard registration failure, and twenty duplicate/reordered MAIN messages. In every case require `paperCallbacks <= 1`, `nativeCaptureCalls === 0`, and `nativeBubbleCalls === 0`.

- [ ] **Step 3: Run the intent tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="first birth href|immediately before resolving|intent cancels|promotion failure" tests/gmgn-adapter.test.js tests/gmgn-quick-buy-world-integration.test.js
```

Expected: the current 2,000 ms generic card intent accepts evidence beyond 300 ms and does not require the new birth object.

- [ ] **Step 4: Re-read identity before recording an intent**

Change the resolving action from `recordQuickBuyIdentityIntent(binding)` to `acceptQuickBuyIdentityActivation(binding, context)`. The function first re-reads unique card-local evidence. If an exact valid href already exists, call `activatePendingQuickBuy` synchronously with the existing paper callback context; the successful commit schedules the normal ready handler once in a microtask. If no href exists, record one frozen intent only when `binding.birth` is still exact and eligible.

The frozen record must include the exact birth object, root, route URL, generation, nonce, chain, amount, paper label, and policy key. Coalesce repeats only when action ID, nonce, and birth object are identical and `now <= expiresAt`.

- [ ] **Step 5: Enforce first-unique-href and 300 ms claim rules**

Before claim, enumerate normalized valid card-local href evidence. Exactly one normalized `{chain,address}` is allowed. On its first appearance, store its normalized href in `birth.firstAddressHref`. Any later removal, second address, or rewrite sets `birth.eligible = false` and deletes the slot intent.

Claim requires:

```js
const valid = intent
  && intent.birth === binding.birth
  && intent.root === binding.birth.root
  && binding.slot.__tangoQuickBuyBinding === binding
  && binding.card === intent.card
  && binding.generation === intent.generation
  && binding.actionId === intent.actionId
  && binding.bindingNonce === intent.bindingNonce
  && binding.chain === intent.chain
  && Number(binding.amountNative) === Number(intent.amountNative)
  && binding.paperLabel === intent.paperLabel
  && binding.policyKey === intent.policyKey
  && global.location.href === intent.routeHref
  && chainFromUrl() === intent.chain
  && now <= intent.createdAt + QUICK_BUY_IDENTITY_INTENT_TTL_MS
  && evidence.href === intent.birth.firstAddressHref
  && intent.root.isConnected && intent.card.isConnected && intent.slot.isConnected;
```

Delete the intent on every failed claim. Passive GMGN fetch/XHR data may confirm an already normalized `{chain,address}` but cannot populate `firstAddressHref`, create a birth, or override any failed DOM condition.

Add `pruneExpiredQuickBuyIdentityIntents(now)` and call it at the start of recording, fast/deferred discovery, and the existing health probe. It deletes entries whose `expiresAt < now` or whose slot/card/root is disconnected; it never executes an intent and adds no timer.

- [ ] **Step 6: Preserve atomic successor publication and one-shot execution**

Keep the current order: stage unpublished DOM, register Guard identity, verify Guard trust, publish the typed action map, reveal, then retire the predecessor/native leaves. Delete the predecessor action only after the successor is trusted. If commit succeeds and an intent was claimed, invoke the successor's normal ready handler exactly once; duplicated or reordered old messages find no live action ID/nonce.

All `resolving-identity`, `ready`, and `in-flight` buttons remain `disabled === false`. Resolving copy says the paper click was accepted while token identity is confirmed; it must not mention market data, price, K-line, or waiting for a quote.

- [ ] **Step 7: Re-run the five-file safety suite**

Run:

```powershell
node --test tests/native-quick-buy-guard.test.js tests/page-main.test.js tests/gmgn-quick-buy-world-integration.test.js tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Expected: all legacy safety cases plus the 300/301 ms, same-click, drift, and twenty-duplicate cases pass with one paper callback at most and zero native callbacks.

---

### Task 3: Owned centered layout and deterministic four-size profiles

**Files:**
- Modify: `src/adapters/gmgn.js:984-1186, 1434-1597`
- Modify: `src/content/content.css:19-97`
- Modify: `src/content/quick-buy-safety.css:16-50`
- Modify: `tests/gmgn-adapter.test.js:18-160, 1566-2118, 2860-2970, 5180-5250`
- Modify: `tests/content-structure.test.js:239-285`

**Interfaces:**
- Consumes: current native presentation discovery and Task 2 paper binding states.
- Produces:

```js
const QUICK_BUY_SIZE_PROFILES = Object.freeze({
  small: Object.freeze({ id: 'small', heightPx: 24, textPx: 12 }),
  large: Object.freeze({ id: 'large', heightPx: 28, textPx: 13 }),
  extraLarge: Object.freeze({ id: 'extra-large', heightPx: 32, textPx: 14 }),
  giant: Object.freeze({ id: 'giant', heightPx: 36, textPx: 16 })
});

quickBuyProfileFromPresentation(className, styleText)
  -> { id: string, heightPx: number, textPx: number }
```

- [ ] **Step 1: Add RED structure and size tests**

Require one owned child wrapper:

```js
const wrapper = harness.replacement.children[0];
assert.equal(wrapper.className, 'tango-quick-buy-content');
assert.deepEqual(wrapper.children.map((child) => child.className), [
  'tango-paper-hint', 'tango-buy-amount'
]);
```

Replace the old `paper quick-buy content scales ... without fixed pixel typography` assertion because the approved contract now intentionally uses canonical `12/13/14/16px` profile values. Preserve the existing outer full-slot assertions and change the fallback assertion to prohibit outer paper dimensions while allowing the owned inner wrapper's canonical variables.

For the existing `LIVE_QUICK_BUY_SMALL`, `LARGE`, `XL`, and `GIANT` fixtures, assert profiles `24/12`, `28/13`, `32/14`, and `36/16`. Assert the replacement CSS variables update immediately after a native class/style size mutation and after a newly inserted meme reuses the current column profile.

- [ ] **Step 2: Add RED geometry and hit-testing tests**

For direct and nested action-host mounts, all four sizes, React reinsertion, fallback presentation, and column background propagation, assert:

```js
assert.ok(Math.abs(box.wrapperCenterX - box.slotCenterX) <= 0.5);
assert.ok(Math.abs(box.wrapperCenterY - box.slotCenterY) <= 0.5);
assert.ok(Math.abs(box.button.width - box.slot.width) <= 1);
assert.ok(Math.abs(box.button.height - box.slot.height) <= 1);
assert.equal(box.pointerEvents, 'auto');
```

Inject hostile native classes/styles for top alignment, column layout, 64 px text, 100 px line-height, gap/padding, zero size, hidden/opacity, transforms, and pointer disabling. None may enter the replacement's shared presentation or move its wrapper.

- [ ] **Step 3: Run layout tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="owned|canonical profile|geometry|four sizes|dynamic|new meme" tests/gmgn-adapter.test.js tests/content-structure.test.js tests/content-runtime.test.js
```

Expected: current DOM has two direct children, relative `0.68em` hint sizing, no exact profile, and native geometry still leaks through presentation copying.

- [ ] **Step 4: Split raw size signals from safe visual tokens**

Parse size from raw class/style before sanitization. Recognize only canonical height/text pairs and map incomplete signals to the nearest canonical profile; otherwise retain the last profile for the same connected trench column, then the current chain, then default to `large`.

The copied visual presentation may retain only color, background, border/radius, outline, box-shadow, fill/stroke, and `--customize-button-ultra-color`. Strip height, width, min/max size, padding, font geometry, line-height, gap, display, flex/grid direction/alignment, text placement, visibility, opacity, position, transforms, and pointer state from both classes and inline style.

- [ ] **Step 5: Render the wrapper and canonical variables**

Change `renderQuickBuyContent` to:

```js
const wrapper = document.createElement('span');
wrapper.className = 'tango-quick-buy-content';
wrapper.append(hint, amount);
replacement.append(wrapper);
```

After selecting a profile, set:

```js
replacement.style.setProperty('--tango-quick-buy-height', `${profile.heightPx}px`);
replacement.style.setProperty('--tango-quick-buy-text', `${profile.textPx}px`);
replacement.dataset.tangoQuickBuySize = profile.id;
```

Profile synchronization must not replace the action ID, nonce, generation, Guard registration, click handler, or paper state.

- [ ] **Step 6: Own all internal geometry in CSS**

Use these invariants:

```css
.tango-list-quick-buy {
  align-items: center !important;
  align-self: stretch !important;
  display: inline-flex !important;
  height: 100% !important;
  justify-content: center !important;
  min-height: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  pointer-events: auto !important;
  width: 100% !important;
}
.tango-quick-buy-content {
  align-items: center !important;
  display: inline-flex !important;
  flex: 0 0 auto !important;
  font-size: var(--tango-quick-buy-text, 13px) !important;
  gap: .22em !important;
  height: var(--tango-quick-buy-height, 28px) !important;
  justify-content: center !important;
  line-height: 1 !important;
  max-width: 100% !important;
}
.tango-paper-hint { font-size: .80em !important; line-height: 1 !important; }
.tango-buy-amount { font-size: 1em !important; line-height: 1 !important; }
```

Remove `.tango-list-quick-buy:disabled`; express busy feedback with `[data-tango-paper-state="in-flight"]` without disabling hit testing. Mirror the full-slot and unpublished fail-closed invariants in `quick-buy-safety.css`.

- [ ] **Step 7: Re-run Task 3 and the five-file safety suite**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-structure.test.js tests/content-runtime.test.js
node --test tests/native-quick-buy-guard.test.js tests/page-main.test.js tests/gmgn-quick-buy-world-integration.test.js tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Expected: all four sizes remain distinct, every new meme gets one full-slot paper button, text never jumps, and native callbacks remain zero.

---

### Task 4: Lock deterministic no-K-line execution and supply arithmetic

**Files:**
- Modify tests first: `tests/content-runtime.test.js:2360-3109, 3700-4133`
- Modify tests first: `tests/engine.test.js:1-1800`
- Modify tests first: `tests/supply.test.js`
- Modify: `tests/state-coordinator.test.js:37-109`
- Modify: `src/core/state-coordinator.js:5-43`
- Modify: `tests/state.test.js`
- Modify: `src/core/state.js:442-485`
- Modify: `src/core/engine.js:189-220`
- Modify only for a demonstrated RED: `src/content/content.js:850-1165, 1320-1365`
- Modify only for a demonstrated RED: `src/core/engine.js`
- Modify only for a demonstrated RED: `src/core/supply.js`

**Interfaces:**
- Consumes: existing `resolvePaperTradeQuote`, `Tango.Supply.resolve`, `Tango.Supply.fallbackValuation`, `Engine.executeBuy`, and `Engine.executeSell`.
- Produces no new state or Engine schema.

- [ ] **Step 1: Add a RED resolver-to-coordinator market-cap preservation test**

Create an unknown-launchpad order shaped exactly like `resolvePaperTradeQuote` output: valid chain/address, `marketCapUsd: 5_000`, `totalSupply: 1_000_000_000`, `priceUsd: 5_000 / 1_000_000_000`, `valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY'`, `marketCapSource: 'GMGN_TRENCH'`, a safe `marketCapObservedAt`, `source: 'TANGO_FALLBACK'`, `syntheticTokenPrice: true`, and the existing provisional/fallback fields. Send it through `StateCoordinator.mutate({ type: 'EXECUTE_BUY', order })` after `structuredClone` and assert:

```js
assert.equal(result.position.lastMarketCapUsd, 5_000);
assert.equal(result.position.lastPriceUsd, 5_000 / 1_000_000_000);
assert.equal(result.position.totalSupply, 1_000_000_000);
assert.equal(result.position.quantity, amountNative * nativePriceUsd
  / (5_000 / 1_000_000_000));
```

The current implementation must fail at 3,200 USD. Add a rejection table proving a wrong `valuationSource`, untrusted/cross-source market-cap provenance, future/stale/unsafe observation time, non-finite/non-positive market cap, noncanonical divisor/supply, forged caller provenance, or incoherent `priceUsd !== marketCapUsd / totalSupply` falls back to the canonical 3,200 USD instead of entering Engine execution.

- [ ] **Step 2: Preserve a coherent observed market cap during canonicalization**

Change `canonicalizeFallbackOrder(order, executionNow)` and pass the coordinator's injected `now()` value from BUY, SELL, and CLOSE_ALL mutations. Compute canonical supply first, then accept the incoming market cap only under this complete contract:

```js
const candidateMarketCapUsd = Number(quote?.marketCapUsd);
const candidatePriceUsd = Number(quote?.priceUsd);
const candidateMarketCapSource = String(quote?.marketCapSource || '').toUpperCase();
const candidateMarketCapObservedAt = Number(
  quote?.marketCapObservedAt || quote?.originalObservedAt || 0
);
const coherentObservedMarketCap = quote?.valuationSource === 'CARD_MARKET_CAP_FALLBACK_SUPPLY'
  && quote?.valuationMode === 'MARKET_CAP'
  && ['GMGN_TRENCH', 'GMGN_DETAIL', 'GMGN_NETWORK'].includes(candidateMarketCapSource)
  && Number.isSafeInteger(candidateMarketCapObservedAt)
  && candidateMarketCapObservedAt > 0
  && candidateMarketCapObservedAt <= executionNow + 5_000
  && executionNow - candidateMarketCapObservedAt <= Number(Tango.QUOTE_STALE_MS || 15_000)
  && Number.isFinite(candidateMarketCapUsd) && candidateMarketCapUsd > 0
  && Number(quote?.totalSupply) === fallback.totalSupply
  && Number(quote?.marketCapDivisor) === fallback.totalSupply
  && Number(quote?.provisionalSupply) === fallback.totalSupply
  && Number.isFinite(candidatePriceUsd) && candidatePriceUsd > 0
  && Math.abs(candidatePriceUsd - candidateMarketCapUsd / fallback.totalSupply)
    <= Math.max(Number.EPSILON, candidatePriceUsd * 1e-9);
const executionMarketCapUsd = coherentObservedMarketCap
  ? candidateMarketCapUsd : fallback.marketCapUsd;
```

After `...fallback`, explicitly set `marketCapUsd: executionMarketCapUsd`, `priceUsd: executionMarketCapUsd / fallback.totalSupply`, and retain `valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY'` only for the coherent case. Use `source: 'TANGO_FALLBACK_CARD_MARKET_CAP'` and `originalObservedAt: candidateMarketCapObservedAt` only for that coordinator-validated case; otherwise keep `source: 'TANGO_FALLBACK'`. Keep `priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP'`, the internal unknown-fallback marker, and delete any caller-provided durable fallback provenance.

- [ ] **Step 3: Extend the existing durable fallback contract without new schema fields**

Use the already persisted `quoteSource` and `quoteObservedAtOriginal` fields; do not add a state field. In Engine's internal unknown-fallback validation, allow `TANGO_FALLBACK_CARD_MARKET_CAP` only when the internal Supply marker exists and market cap/price/supply are coherent. In State's `isCanonicalUnknownFallbackOrigin`, preserve the existing exact-3,200 branch and add a second branch requiring:

```js
String(trade.quoteSource).toUpperCase() === 'TANGO_FALLBACK_CARD_MARKET_CAP'
  && Number.isSafeInteger(trade.quoteObservedAtOriginal)
  && trade.quoteObservedAtOriginal > 0
  && trade.quoteObservedAtOriginal <= trade.executedAt
  && Number(trade.marketCapUsd) > 0
  && Number(trade.observedPriceUsd) > 0
  && Math.abs(trade.marketCapUsd / trade.observedPriceUsd - 1_000_000_000)
    <= 1_000_000_000 * 0.001;
```

All existing side, durable provenance, supply/divisor, provisional, paper-fallback, synthetic-price, and MARKET_CAP conditions still apply before either branch. Add strict State positive tests for the coordinator-issued marker and negative tests for forged source/time/ratio combinations.

- [ ] **Step 4: Add a RED factual-price/synthetic-market-cap ratio test**

Pass a factual GMGN price-only observation such as `priceUsd: 0.01` with no factual market cap or supply through `resolvePaperTradeQuote` and real Engine execution. Assert the filled fallback market cap is explicitly marked synthetic and cannot become `GMGN_RATIO`; the execution supply remains unknown 1B and the quantity is based on the factual price:

```js
assert.equal(result.position.totalSupply, 1_000_000_000);
assert.equal(result.position.supplySource, 'UNKNOWN_FALLBACK');
assert.equal(result.position.lastPriceUsd, 0.01);
assert.notEqual(result.position.totalSupply, 320_000);
```

In `resolvePaperTradeQuote`, when `executionMarketCap` came from the 3,200 fallback rather than a factual or historical market cap, emit `marketCapSource: 'TANGO_FALLBACK'`, `marketCapObservedAt: 0`, and an empty market-cap observation ID. Preserve the actual GMGN `priceSource`, price observation ID, and price time. This keeps `coherentRatioObservation()` available only when both dimensions are factual and from the same observation.

- [ ] **Step 5: Run the coordinator, State, and ratio tests**

Run:

```powershell
node --test --test-name-pattern="structured-cloned unknown fallback|observed market cap|factual price.*synthetic market cap|canonical unknown fallback" tests/state-coordinator.test.js tests/state.test.js tests/content-runtime.test.js tests/engine.test.js
```

- [ ] **Step 6: Add the valid-address no-market matrix**

For `sol`, `eth`, `bsc`, `base`, `robinhood`, and `xlayer`, run quick-buy and detail-buy contexts with a valid address and no K-line, token price, market cap, native price, symbol, image, or launchpad. Assert immediate commit with:

```js
assert.equal(quote.marketCapUsd, 3_200);
assert.equal(quote.totalSupply, 1_000_000_000);
assert.equal(quote.priceUsd, 3_200 / 1_000_000_000);
assert.equal(quote.nativePriceUsd, 1);
assert.equal(quote.syntheticTokenPrice, true);
assert.equal(quote.syntheticNativePrice, true);
assert.equal(quote.paperFallback, true);
```

Assert no case emits `nativePriceUnavailable`, `staleQuote`, `invalidQuote`, `invalidArithmetic`, or real-time-price copy.

- [ ] **Step 7: Add exact launchpad quantity and sell matrices**

Cover Pump.fun 1B, Pump Mayhem 2B, Four.meme 1B, Flap 1B, Zora 1B, DYOR 1B, Bow 1B, Bankr/Banker/Bankr.bot/Clanker 100B on both Base and Robinhood, plus unknown 1B. With zero fees and a synthetic native price of 1 USD, assert:

```js
assert.equal(bought.position.quantity, amountNative / (3_200 / expectedSupply));
assert.ok(Number.isFinite(bought.position.quantity));
```

Then sell 25% and exact 100% of the remainder. Every quantity, proceeds, PnL, and cash balance must be finite; the final position is removed and the chain cash returns to its zero-fee starting value.

- [ ] **Step 8: Lock factual upgrades without history mutation**

After a fallback buy, publish a trustworthy exact same-token GMGN/K-line price, supply, and native price. Assert the current mark/marker uses factual dimensions and the original BUY record remains byte-for-byte equal. A 1B-to-2B or 1B-to-100B representation correction adjusts remaining quantity neutrally; simultaneous factual token-price movement remains economic PnL.

- [ ] **Step 9: Run the quote/Engine matrix**

Run:

```powershell
node --test tests/gmgn-quotes.test.js tests/supply.test.js tests/engine.test.js tests/state.test.js tests/state-coordinator.test.js tests/content-runtime.test.js tests/markers.test.js
```

Expected: the verified baseline should remain green. If a new RED exposes a coupling, retain this exact resolution order:

```js
const executionSupply = exactSupply || verifiedLaunchpadSupply || 1_000_000_000;
const priceUsd = trustworthyPrice
  || (trustworthyMarketCap > 0 ? trustworthyMarketCap / executionSupply : 0)
  || (3_200 / executionSupply);
const nativePriceUsd = trustworthyExactChainNativePrice || 1;
```

Do not weaken invalid chain/address, insufficient paper balance, unsafe settings, or non-finite arithmetic checks.

---

### Task 5: Preservation regressions, independent review, and release verification

**Files:**
- Verify: all modified `src/`, `tests/`, `manifest.json`, and `scripts/validate-extension.js`
- Generate only after source gates pass: `dist/tango-paper-trader/**`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: verified unpacked extension at `D:\web3\code_project\tango-paper-trade\.worktrees\codex-gmgn-ui-safety\dist\tango-paper-trader`.

- [ ] **Step 1: Run focused preservation suites**

Run:

```powershell
node --test tests/content-runtime.test.js tests/markers.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js tests/background.test.js
```

Require current-route chain balances/positions/trades/PnL only, no selected-chain write loop or flicker, synchronized Popup and `Alt+Shift+P`, onboarding allocation to every chain, the approved GMGN referral URL, detail panel before K-line readiness, BUY/SELL marker replay, OFF marker clearing, and ON reconstruction.

- [ ] **Step 2: Perform independent spec and code-quality reviews**

Give a fresh reviewer the approved design, this plan, and the task-scoped diff. Fix every blocking finding, rerun the task's focused tests, then obtain a clean re-review. Reviews must explicitly check birth-only auto-claim, the inclusive 300 ms boundary, zero native callbacks, owned layout, deterministic fallback arithmetic, and preservation of unrelated user changes.

- [ ] **Step 3: Review the complete diff and forbidden capabilities**

Run:

```powershell
git diff --check
rg -n "ethereum|personal_sign|eth_sign|eth_sendTransaction|sendTransaction|signTransaction|connectWallet|approve|swap/route|broadcastTransaction|new WebSocket" src manifest.json
```

Every match must be an existing validator/test string or proven unrelated to executable real-funds capability. Do not open or operate GMGN trading UI.

- [ ] **Step 4: Run all source gates**

Run:

```powershell
npm.cmd test
npm.cmd run check
```

Both commands must exit zero before building.

- [ ] **Step 5: Build and repeat all gates**

Run only after Step 4 passes:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run check
```

- [ ] **Step 6: Compare source/package file sets and SHA-256 hashes**

Use this Windows PowerShell 5.1-compatible gate:

```powershell
$ErrorActionPreference = 'Stop'
$packageRoot = (Resolve-Path 'dist\tango-paper-trader').Path.TrimEnd('\')
$repoRoot = (Resolve-Path '.').Path.TrimEnd('\')
$sourceRoots = @(
  'manifest.json','popup.html','dashboard.html',
  'README.md','PRIVACY.md','src',
  'docs/multichain-smoke-test.md'
)
$expected = @{}
foreach ($entry in $sourceRoots) {
  $resolved = Resolve-Path $entry
  if ((Get-Item $resolved).PSIsContainer) {
    Get-ChildItem -LiteralPath $resolved -Recurse -File | ForEach-Object {
      $relative = $_.FullName.Substring($repoRoot.Length + 1).Replace('/','\')
      $expected[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
    }
  } else {
    $relative = $entry.Replace('/','\')
    $expected[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash
  }
}
$actual = @{}
Get-ChildItem -LiteralPath $packageRoot -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace('/','\')
  $actual[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
}
$allRelative = @($expected.Keys) + @($actual.Keys) | Sort-Object -Unique
$differences = foreach ($relative in $allRelative) {
  if (-not $actual.ContainsKey($relative)) {
    [pscustomobject]@{ Relative=$relative; Status='MissingInPackage' }
  } elseif (-not $expected.ContainsKey($relative)) {
    [pscustomobject]@{ Relative=$relative; Status='ExtraInPackage' }
  } elseif ($expected[$relative] -ne $actual[$relative]) {
    [pscustomobject]@{ Relative=$relative; Status='HashMismatch' }
  }
}
if ($differences) {
  $differences | Format-Table -AutoSize
  throw 'Source/package mismatch'
}
```

Expected: exactly 32 packaged files and no difference rows.

- [ ] **Step 7: Synchronize and verify the established Chrome loading directory**

After the worktree package hash gate passes, validate the exact target and replace only that unpacked-extension directory:

```powershell
$packageSource = (Resolve-Path 'dist\tango-paper-trader').Path
$chromeTarget = [IO.Path]::GetFullPath(
  'D:\web3\code_project\tango-paper-trade\dist\tango-paper-trader'
)
$expectedTarget = 'D:\web3\code_project\tango-paper-trade\dist\tango-paper-trader'
if ($chromeTarget -ne $expectedTarget) { throw 'Unexpected Chrome target' }
if (Test-Path -LiteralPath $chromeTarget) {
  Remove-Item -LiteralPath $chromeTarget -Recurse -Force
}
Copy-Item -LiteralPath $packageSource -Destination $chromeTarget -Recurse
```

Compare the relative file set and SHA-256 values of `$packageSource` and `$chromeTarget`; require exactly 32 equal files and zero differences.

- [ ] **Step 8: Report the verified Chrome loading directory**

Run:

```powershell
Resolve-Path 'dist/tango-paper-trader'
Resolve-Path 'D:\web3\code_project\tango-paper-trade\dist\tango-paper-trader'
git status --short
```

Report exact focused/full test counts, validator result, package identity result, loading directory, and preserved working-tree state. Do not stage or commit.

---

## Self-Review Checklist

- [x] Every approved first-frame requirement maps to a concrete task: synchronous mutation discovery, genuine added-root birth, 300 ms intent, same-click promotion, drift cancellation, and atomic Guard publication.
- [x] Every layout requirement maps to exact DOM, profile, CSS, hostile-presentation, and hit-box assertions.
- [x] Every no-K-line requirement maps to a six-chain quote matrix, the complete 1B/2B/100B table, partial/full sells, and later factual calibration.
- [x] `CardBirth`, intent, action ID, binding nonce, generation, route, chain, amount, and TTL names are consistent across tasks.
- [x] No step adds wallet, signing, approval, swap, RPC broadcast, native GMGN activation, WebSocket, or a network request.
- [x] No step permits staging, committing, resetting, cleaning, stashing, branch switching, or overwriting unrelated changes.
- [x] The plan contains no TBD, TODO, placeholder, or unspecified error-handling step.
