# GMGN Trusted Quick-Buy and Locked Giant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GMGN trench paper quick-buy activation isolated-world-only, lock every replacement control to one exact Giant Tango presentation, reject synthetic shell mutations, and keep MAIN-world quote observations ephemeral.

**Architecture:** The document-start isolated guard becomes the only holder of executable quick-buy callbacks and invokes them directly from a browser-trusted click after revalidating the live binding. The GMGN adapter retains structural discovery and paper-order behavior but no longer imports native presentation or consumes a MAIN-world action message; content UI mutations use strict trusted-event entry gates, while page-derived quotes remain bounded runtime cache inputs only.

**Tech Stack:** Chrome Extension Manifest V3, isolated and MAIN content-script worlds, plain JavaScript, DOM/CSS, Node.js `node:test`, VM integration harnesses, headless Chrome layout verification.

## Global Constraints

- Never activate, reveal, or forward an event to a GMGN native trading control.
- Do not add wallet, signature, approval, swap, RPC, real-funds, network, or host-permission capabilities.
- Keep chain/token identity validation and iframe READY correlation fail-closed.
- Keep quote selection, paper Engine accounting, balances, positions, order semantics, marker economics, and the two-line quick-buy content unchanged except for the authorization and presentation boundaries in this plan.
- A permitted quick-buy activation produces exactly one paper callback and zero native callbacks.
- A page-authored `Event`, `.click()`, public action ID, DOM dataset value, or same-window message is not proof of user intent.
- Every replacement quick-buy has exact `height`, `min-height`, and `max-height` of `36px`, amount text of `14px`, Paper hint text of `10px`, and `data-tango-quick-buy-size="giant"`.
- The bound slot and slot-local action host have a minimum height of `36px`; a taller host centers rather than stretches the replacement.
- Tango quick-buy color, radius, focus, hover, active, pending, and in-flight presentation never comes from GMGN classes, styles, or custom properties.
- Preserve the current 16% normal and 24% hover surface-opacity policy.
- Page-derived quote messages may update runtime display and decision caches, but cannot persist metadata or schedule calibration.
- Keep `manifest.json` permissions unchanged; do not add `unlimitedStorage`.
- Preserve unrelated user files and worktree changes.
- Production changes follow strict RED, GREEN, refactor order: each focused test must fail for the stated missing behavior before its implementation is written.

## File Structure

- `src/content/native-quick-buy-guard.js`: owns opaque quick-buy callbacks, validates trusted clicks, blocks every native sentinel path.
- `src/adapters/gmgn.js`: discovers verified GMGN trench slots, binds paper actions to the isolated guard, and applies the locked Giant presentation.
- `src/content/page-main.js`: observes GMGN network responses only; it has no paper-action publisher or listener.
- `src/content/content.js`: gates user-initiated shell mutations and treats MAIN-world quote messages as ephemeral input.
- `src/content/content.css`: owns all Giant geometry and visual tokens.
- `tests/native-quick-buy-guard.test.js`: unit coverage for trusted click semantics, identity drift, revocation, and keyboard default behavior.
- `tests/gmgn-quick-buy-world-integration.test.js`: cross-world proof that forged messages cannot reach paper callbacks and native listeners remain untouched.
- `tests/gmgn-adapter.test.js`: structural lifecycle, action-identity, hostile-presentation, two-slot, and headless layout coverage.
- `tests/page-main.test.js`: verifies MAIN-world quote interception without any trade activation relay.
- `tests/content-runtime.test.js`: shell mutation gates and ephemeral quote-cache coverage.
- `tests/content-structure.test.js`: manifest ordering and paper-only permission boundary; obsolete native-presentation ownership assertions are removed.
- `manifest.json`: inspected but unchanged; the isolated guard already runs at `document_start` before the document-idle adapter.
- `dist/tango-paper-trader/src/content/native-quick-buy-guard.js`, `dist/tango-paper-trader/src/content/page-main.js`, `dist/tango-paper-trader/src/content/content.js`, `dist/tango-paper-trader/src/content/content.css`, `dist/tango-paper-trader/src/adapters/gmgn.js`: build-generated runtime copies verified against source at the end.

---

### Task 1: Move Quick-Buy Authority Into the Isolated Guard

**Files:**
- Modify: `tests/native-quick-buy-guard.test.js:22-347`
- Modify: `tests/gmgn-quick-buy-world-integration.test.js:11-574`
- Modify: `tests/page-main.test.js:1-532`
- Modify: `tests/gmgn-adapter.test.js:1-21,917-1013,5389-5534,6855-7128`
- Modify: `src/content/native-quick-buy-guard.js:6-188`
- Modify: `src/adapters/gmgn.js:3-42,1482-1624,2753-2823`
- Modify: `src/content/page-main.js:5-117`

**Interfaces:**
- Consumes: the existing adapter binding fields `replacement`, `slot`, `card`, `actionId`, `bindingNonce`, `generation`, `state`, `chain`, `address`, `href`, `amountNative`, and `action.invoke`.
- Produces: `Tango.NativeQuickBuyGuard.registerPaperAction(element, identity, activate) -> boolean`, `isPaperActionTrusted(element, identity) -> boolean`, and `revokePaperAction(element) -> boolean`.
- Produces: a single opaque `activate` callback stored only in the Guard `WeakMap`; `actionId` and `bindingNonce` remain diagnostics and correlation values, never callback lookup keys.
- Removes: `Tango.GMGN._invokeQuickBuyAction`, the adapter action Map, the adapter same-window transaction listener, `slot.__tangoQuickBuyHandler`, and MAIN-world `PAPER_QUICK_BUY_INTENT` / `PAPER_QUICK_BUY_CLICK` publishing.

- [ ] **Step 1: Write failing isolated-guard tests for synthetic rejection and trusted click activation**

Update `paperIdentity()` so its binding can carry the exact opaque callback that registration validates:

```js
function paperIdentity(loaded, actionId, patch = {}) {
  const address = '0x1111111111111111111111111111111111111111';
  const element = new loaded.FakeElement(['[data-tango-paper-action="quick-buy"]']);
  const slot = new loaded.FakeElement(['.BuyButton-continer']);
  const card = new loaded.FakeElement(['[class~="group/a"]']);
  const state = patch.state || 'ready';
  const generation = Number(patch.generation || 1);
  const bindingNonce = patch.bindingNonce || `nonce-${generation}`;
  const activate = patch.activate || (() => undefined);
  const binding = {
    replacement: element, slot, card, actionId, bindingNonce, generation, state,
    chain: 'base', address, href: `https://gmgn.ai/base/token/${address}`,
    amountNative: 1, action: { bindingNonce, kind: state === 'resolving-identity' ? 'intent' : 'execute', invoke: activate }
  };
  Object.assign(element.dataset, {
    tangoPaperAction: 'quick-buy', tangoActionId: actionId,
    tangoBindingNonce: bindingNonce, tangoCardGeneration: String(generation),
    tangoPaperState: state
  });
  Object.assign(slot.dataset, {
    tangoQuickBuy: '1', tangoActionId: actionId,
    tangoBindingNonce: bindingNonce, tangoCardGeneration: String(generation),
    tangoPaperState: state
  });
  slot.__tangoQuickBuyBinding = binding;
  slot.__tangoReplacementQuickBuy = element;
  slot.__tangoQuickBuyCard = card;
  slot.appendChild(element);
  card.appendChild(slot);
  return {
    element, slot, card, binding, activate, actionId, bindingNonce, generation, state,
    chain: binding.chain, address: binding.address, href: binding.href,
    amountNative: binding.amountNative
  };
}
```

Add these tests to `tests/native-quick-buy-guard.test.js`:

```js
test('isolated guard rejects forged datasets messages and synthetic activation', () => {
  const loaded = loadGuard(new Promise(() => {}));
  const guard = loaded.context.Tango.NativeQuickBuyGuard;
  let activations = 0;
  const identity = paperIdentity(loaded, 'opaque-action', {
    activate: () => { activations += 1; }
  });

  assert.equal(guard.registerPaperAction(identity.element, identity, identity.activate), true);
  for (const [type, overrides] of [
    ['pointerdown', { isTrusted: false, button: 0, pointerId: 1, isPrimary: true }],
    ['pointerup', { isTrusted: false, button: 0, pointerId: 1, isPrimary: true }],
    ['keydown', { isTrusted: false, key: 'Enter', repeat: false }],
    ['keyup', { isTrusted: false, key: 'Enter', repeat: false }],
    ['click', { isTrusted: false, button: 0, detail: 0 }]
  ]) {
    assertBlocked(loaded.dispatch(type, [identity.element, identity.slot], overrides), type);
  }
  assert.equal(activations, 0);

  identity.element.dataset.tangoActionId = 'page-readable-forgery';
  assertBlocked(loaded.dispatch('click', [identity.element, identity.slot], {
    isTrusted: true, button: 0, detail: 1
  }));
  assert.equal(activations, 0);
});

test('trusted pointer and browser keyboard clicks invoke one opaque paper callback', () => {
  const loaded = loadGuard(new Promise(() => {}));
  const guard = loaded.context.Tango.NativeQuickBuyGuard;
  let activations = 0;
  const identity = paperIdentity(loaded, 'trusted-action', {
    activate: () => { activations += 1; }
  });
  assert.equal(guard.registerPaperAction(identity.element, identity, identity.activate), true);

  const pointerDown = loaded.dispatch('pointerdown', [identity.element, identity.slot], {
    isTrusted: true, button: 0, pointerId: 7, isPrimary: true
  });
  assert.deepEqual(pointerDown, { prevented: false, stopped: true, immediate: true });
  const pointerUp = loaded.dispatch('pointerup', [identity.element, identity.slot], {
    isTrusted: true, button: 0, pointerId: 7, isPrimary: true
  });
  assert.deepEqual(pointerUp, { prevented: false, stopped: true, immediate: true });
  assertBlocked(loaded.dispatch('click', [identity.element, identity.slot], {
    isTrusted: true, button: 0, detail: 1
  }));
  assert.equal(activations, 1);

  const keyDown = loaded.dispatch('keydown', [identity.element, identity.slot], {
    isTrusted: true, key: 'Enter', repeat: false
  });
  const keyUp = loaded.dispatch('keyup', [identity.element, identity.slot], {
    isTrusted: true, key: 'Enter', repeat: false
  });
  assert.deepEqual(keyDown, { prevented: false, stopped: true, immediate: true });
  assert.deepEqual(keyUp, { prevented: false, stopped: true, immediate: true });
  assertBlocked(loaded.dispatch('click', [identity.element, identity.slot], {
    isTrusted: true, button: 0, detail: 0
  }));
  assert.equal(activations, 2);
});
```

Retain the existing drift, React-remount, settings-read, and revocation matrices, but pass `identity.activate` as the third registration argument and change registered-paper event expectations from allowed to propagation-stopped.

- [ ] **Step 2: Run the isolated-guard tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="isolated guard rejects forged|trusted pointer and browser keyboard" tests/native-quick-buy-guard.test.js
```

Expected: FAIL because `registerPaperAction` ignores the third callback, registered trusted clicks do not invoke it, and registered paper precursor events currently remain allowed.

- [ ] **Step 3: Write failing cross-world and MAIN-world relay tests**

In `tests/gmgn-quick-buy-world-integration.test.js`, remove the assertion that an adapter `message` listener exists. Change `dispatchTrustedPair()` into a real browser activation sequence:

```js
function dispatchTrustedActivation(paper, detail = 1) {
  dispatchTrusted('pointerdown', paper, { pointerId: 11, isTrusted: true });
  dispatchTrusted('pointerup', paper, { pointerId: 11, isTrusted: true });
  dispatchTrusted('click', paper, { button: 0, detail, isTrusted: true });
}
```

Expose that helper from `loadIntegratedQuickBuyWorld()`:

```js
return {
  mountReadyPaper, mountResolvingPaper, replaceNativeAncestor,
  dispatchTrusted, dispatchTrustedActivation, mutateCore,
  paperOrders, paperAssets, clock,
  setRoute(href) { guardContext.location.href = href; },
  deliver(message) {
    const listeners = registrations.filter((entry) => entry.world === 'guard' && entry.type === 'message');
    for (const entry of listeners) entry.listener({ source: guardContext, data: message });
  },
  get paperCallbacks() { return paperCallbacks; },
  get nativeCaptureCalls() { return nativeCaptureCalls; },
  get nativeBubbleCalls() { return nativeBubbleCalls; }
};
```

Add these integration tests:

```js
test('trusted isolated activation invokes paper once without a MAIN action message', () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountReadyPaper({ chain: 'base', address: EVM_ADDRESS });
  world.dispatchTrustedActivation(mounted.paper);
  assert.equal(world.paperCallbacks, 1);
  assert.equal(world.paperOrders.length, 0);
  assert.equal(world.nativeCaptureCalls, 0);
  assert.equal(world.nativeBubbleCalls, 0);
});

test('forged public identity messages cannot mutate ready or resolving paper assets', async () => {
  const world = loadIntegratedQuickBuyWorld();
  const ready = world.mountReadyPaper({ chain: 'base', address: EVM_ADDRESS });
  const resolving = world.mountResolvingPaper();
  const before = structuredClone(world.paperAssets);

  for (const mounted of [ready, resolving]) {
    world.deliver({
      source: 'TANGO_GMGN_PAGE',
      type: mounted.binding.state === 'resolving-identity'
        ? 'PAPER_QUICK_BUY_INTENT' : 'PAPER_QUICK_BUY_CLICK',
      actionId: mounted.paper.dataset.tangoActionId,
      bindingNonce: mounted.paper.dataset.tangoBindingNonce
    });
  }
  resolving.exposeHref();
  resolving.reconcile();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(world.paperCallbacks, 0);
  assert.deepEqual(world.paperAssets, before);
  assert.equal(world.nativeCaptureCalls + world.nativeBubbleCalls, 0);
});
```

In `tests/page-main.test.js`, remove tests that expect pointer/key bridging and add:

```js
test('MAIN quote tap registers no paper activation relay', () => {
  const loaded = loadPageMain(async () => jsonResponse({}));
  const transactionEvents = new Set([
    'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup',
    'touchstart', 'touchend', 'click', 'auxclick', 'keydown', 'keyup'
  ]);
  assert.deepEqual(
    loaded.listenerRegistrations.filter((entry) => transactionEvents.has(entry.type)),
    []
  );
  assert.deepEqual(loaded.paperPublished, []);
});
```

- [ ] **Step 4: Run the cross-world and MAIN-world tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="trusted isolated activation|forged public identity|MAIN quote tap registers no paper" tests/gmgn-quick-buy-world-integration.test.js tests/page-main.test.js
```

Expected: FAIL because trusted activation still depends on MAIN `postMessage`, forged action messages still reach the adapter Map, and page-main still registers transaction event listeners.

- [ ] **Step 5: Implement the opaque callback registration and direct trusted-click path**

In `src/content/native-quick-buy-guard.js`, add one consumed-event set beside `trustedPaperActions`:

```js
const trustedPaperActions = new WeakMap();
const consumedTrustedClicks = new WeakSet();
```

Extend `currentPaperCoreIdentity()` with the callback/binding invariant:

```js
&& typeof identity.activate === 'function'
&& identity.binding.action?.invoke === identity.activate
```

Replace `hasTrustedPaperActionBeforeNative()` with a descriptor-returning function:

```js
function trustedPaperActionBeforeNative(elements) {
  let trustedIdentity = null;
  for (const element of elements) {
    if (!trustedIdentity) trustedIdentity = trustedPaperCoreIdentity(element);
    if (!isNativeQuickBuy(element)) continue;
    if (!trustedIdentity || !pathAuthorizesPaper(elements, trustedIdentity)) return null;
    const currentAncestors = captureNativeAncestors(trustedIdentity.slot);
    if (!sameNativeAncestors(trustedIdentity.nativeAncestors, currentAncestors)) {
      trustedIdentity = Object.freeze({
        ...trustedIdentity,
        nativeAncestors: currentAncestors
      });
      trustedPaperActions.set(trustedIdentity.element, trustedIdentity);
    }
    if (trustedIdentity.slot === element || trustedIdentity.nativeAncestors.includes(element)) continue;
    return null;
  }
  return trustedIdentity;
}
```

Replace `blockNativeActivation()` with:

```js
function stopActivation(event, preventDefault) {
  if (preventDefault) event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function blockNativeActivation(event) {
  if (!blockNativeQuickBuy) return;
  if ((event.type === 'keydown' || event.type === 'keyup')
    && event.key !== 'Enter' && event.key !== ' ') return;
  const elements = eventElements(event);
  const identity = trustedPaperActionBeforeNative(elements);
  if (identity) {
    const click = event.type === 'click';
    const trustedPrimaryClick = click
      && event.isTrusted === true
      && (event.button == null || event.button === 0);
    stopActivation(event, click || event.type === 'auxclick' || event.isTrusted !== true);
    if (!trustedPrimaryClick || consumedTrustedClicks.has(event)) return;
    consumedTrustedClicks.add(event);
    try {
      Promise.resolve(identity.activate()).catch(() => null);
    } catch {}
    return;
  }
  if (!elements.some(isNativeQuickBuy)) return;
  stopActivation(event, true);
}
```

Change Guard registration to consume and store the callback:

```js
registerPaperAction(element, identity, activate) {
  if (!(element instanceof global.Element) || typeof activate !== 'function') return false;
  const descriptor = Object.freeze({
    element,
    slot: identity?.slot,
    card: identity?.card,
    binding: identity?.binding,
    actionId: identity?.actionId,
    bindingNonce: identity?.bindingNonce,
    generation: identity?.generation,
    state: identity?.state,
    chain: identity?.chain,
    address: identity?.address,
    href: identity?.href,
    amountNative: identity?.amountNative,
    activate,
    nativeAncestors: captureNativeAncestors(identity?.slot)
  });
  if (!currentPaperCoreIdentity(element, descriptor)) {
    trustedPaperActions.delete(element);
    return false;
  }
  trustedPaperActions.set(element, descriptor);
  return true;
}
```

Update `isPaperActionTrusted()` so its live identity check reuses the opaque callback already held by the descriptor:

```js
isPaperActionTrusted(element, identity) {
  const descriptor = trustedPaperCoreIdentity(element);
  return Boolean(descriptor)
    && currentPaperCoreIdentity(element, {
      ...identity,
      element,
      activate: descriptor.activate
    })
    && sameNativeAncestors(descriptor.nativeAncestors, captureNativeAncestors(descriptor.slot));
}
```

- [ ] **Step 6: Remove every alternate transaction bridge from the adapter and MAIN world**

In `src/adapters/gmgn.js`, replace the prologue from `const quickBuyActions` through
`invokeQuickBuyAction()` with this prologue, which retains every non-transaction
runtime registry while removing the public-message authority path:

```js
(function initGmgnAdapter(global) {
  const Tango = global.Tango = global.Tango || {};
  const quickBuyIntents = new Map();
  const quickBuyCardGenerations = new WeakMap();
  let quickBuyCardBirths = new WeakMap();
  let quickBuySeenTokenRoots = new WeakSet();
  const quickBuyOperations = new Map();
  const trackedQuickBuySlots = new Set();
  const trenchColumns = new WeakMap();
  let quickBuyPresentationsByColumn = new WeakMap();
  const quickBuyPresentationsByChain = new Map();
  const trenchSnapshots = new Map();
  const MAX_TRENCH_SNAPSHOTS = 200;
  const QUICK_BUY_IDENTITY_INTENT_TTL_MS = 300;
  const FDV_MARKET_CAP_TOLERANCE = 2;
  let lastVerifiedDetail = null;
  let quickBuyProbeCursor = 0;
  let quickBuyPresentationRevision = 0;
  let quickBuyGenerationSequence = 0;
  let quickBuyNonceSequence = 0;
  const TOKEN_ITEM_ROOT_SELECTOR =
    '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]';
  const FAST_QUICK_BUY_SLOT_LIMIT = 24;
  let chartTrustByFrame = new WeakMap();
  const CHART_FRAME_SELECTOR = 'iframe[title="Financial Chart"], iframe[title="TradingView"], [data-sentry-component="TradingView"] iframe';

  function cardGeneration(card) {
    if (!quickBuyCardGenerations.has(card)) {
      quickBuyCardGenerations.set(card, ++quickBuyGenerationSequence);
    }
    return quickBuyCardGenerations.get(card);
  }
```

The existing `advanceCardGeneration()` follows this block; there is no
`window.addEventListener('message', ...)` transaction listener between the constants
and `cardGeneration()`.

Change the return in `registerPaperQuickBuy()` to:

```js
return Tango.NativeQuickBuyGuard?.registerPaperAction?.(replacement, {
  slot, card, binding, actionId: expectedActionId, bindingNonce, generation, state,
  chain, address, href, amountNative
}, binding.action?.invoke) === true;
```

Remove `handler` from `publicationSnapshot()` and `restorePublicationSnapshot()`. Remove every assignment or deletion of `slot.__tangoQuickBuyHandler`, every `quickBuyActions.set/delete`, and the `_invokeQuickBuyAction` export. Keep `binding.action = action` in `commitPaperQuickBuy()` because Guard registration validates and captures that exact function.

In `src/content/page-main.js`, delete the declarations and functions from `paperActionDispatchAt` through the `paperTradeEvents.forEach(...)` registration. The first remaining runtime declaration after the top-level initialization guard is:

```js
const quoteCache = new Map();
let lastRequestObservedAt = 0;
```

Update adapter test Guard doubles to accept the third argument and expose it only through test code:

```js
function guardHarness({ registerResult = true } = {}) {
  const actions = new WeakMap();
  return {
    registerResult,
    failNext: false,
    failRegistrations: 0,
    trusted: false,
    descriptor: null,
    registrations: [],
    registerPaperAction(element, descriptor, activate) {
      this.descriptor = { element, ...descriptor, activate };
      this.registrations.push(this.descriptor);
      const result = typeof activate === 'function'
        && !(this.failNext || this.failRegistrations > 0)
        && this.registerResult;
      this.failNext = false;
      if (this.failRegistrations > 0) this.failRegistrations -= 1;
      this.trusted = result;
      if (result) actions.set(element, activate);
      else actions.delete(element);
      return result;
    },
    isPaperActionTrusted(element, descriptor) {
      return this.trusted && element === this.descriptor?.element
        && descriptor.actionId === this.descriptor?.actionId
        && descriptor.bindingNonce === this.descriptor?.bindingNonce;
    },
    revokePaperAction(element) {
      this.trusted = false;
      actions.delete(element);
      return true;
    },
    invokeRegistered(element) {
      return actions.get(element)?.();
    }
  };
}
```

- [ ] **Step 7: Run focused and neighboring suites and verify GREEN**

Run:

```powershell
node --test tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/page-main.test.js
node --test --test-name-pattern="Guard registration failure|resolving publication|in-flight paper|identity intent|native callbacks" tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Expected: PASS; trusted pointer and keyboard-generated clicks invoke exactly one registered paper callback, synthetic events and forged messages invoke none, and every native listener count remains zero.

- [ ] **Step 8: Commit the isolated authority boundary**

```powershell
git add tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/page-main.test.js tests/gmgn-adapter.test.js src/content/native-quick-buy-guard.js src/adapters/gmgn.js src/content/page-main.js
git commit -m "fix: move quick buy authority into isolated guard"
```

---

### Task 2: Lock Every Trench Replacement to Tango Giant Presentation

**Files:**
- Modify: `tests/gmgn-adapter.test.js:27-780,2220-4181`
- Modify: `tests/content-structure.test.js:223-320`
- Modify: `src/adapters/gmgn.js:1180-1458,1795-2057,2325-2470,2635-2810`
- Modify: `src/content/content.css:19-147`

**Interfaces:**
- Consumes: verified TokenItem/card discovery, `.BuyButton-continer`, the slot-local `[class~="group/btn"]` host, native control restoration provenance, amount parsing, binding state, and Guard registration from Task 1.
- Produces: `LOCKED_QUICK_BUY_PROFILE = { id: 'giant', heightPx: 36, amountTextPx: 14, hintTextPx: 10 }`.
- Produces: `applyLockedQuickBuyPresentation(replacement, slot) -> LOCKED_QUICK_BUY_PROFILE` and `syncQuickBuyPresentation(slot) -> boolean`.
- Preserves: replacement node, binding object, action function, generation, action identity, pending state, in-flight operation, quote, and callback across all native presentation mutations.
- Removes: Small/Large/Extra large inference, profile promotion, native class/style copying, per-column/per-chain presentation cache, presentation-only observers and repair timers, and health comparisons against connected native presentation.

- [ ] **Step 1: Replace contradictory profile tests with a failing locked-Giant matrix**

Remove the old tests that require four Tango profiles or native presentation copying. Add:

```js
test('all native presentations produce one locked Tango giant control', () => {
  const fixtures = [
    [LIVE_QUICK_BUY_SMALL, 'height:24px;color:red;border-radius:2px;--customize-button-ultra-color:#f00;'],
    [LIVE_QUICK_BUY_LARGE, 'height:28px;color:green;border-radius:4px;--customize-button-ultra-color:#0f0;'],
    [LIVE_QUICK_BUY_XL, 'height:32px;color:blue;border-radius:12px;--customize-button-ultra-color:#00f;'],
    [LIVE_QUICK_BUY_GIANT, 'height:36px;color:white;border-radius:20px;--customize-button-ultra-color:#fff;'],
    ['hidden pointer-events-none !h-[100px] !text-[64px] rounded-full text-red-500',
      'height:100px;font-size:64px;color:red;border-radius:9999px;--customize-button-ultra-color:#f00;']
  ];

  for (const [className, styleText] of fixtures) {
    const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
    harness.setNativePresentation(className, styleText);
    withQuickBuyGlobals(harness, {}, () => {
      assert.equal(GMGN.discoverTokenCards(() => {}), 1);
      assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
      assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');
      assert.equal(harness.replacement.className, 'tango-list-quick-buy');
      assert.equal(harness.replacement.style.cssText, '');
      assert.deepEqual(harness.replacement.children.map((child) => child.className), [
        'tango-quick-buy-content'
      ]);
      assert.deepEqual(harness.replacement.children[0].children.map((child) => child.className), [
        'tango-paper-hint', 'tango-buy-amount'
      ]);
    });
  }
});

test('native presentation mutation preserves giant geometry and action identity', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness();
  withQuickBuyGlobals(harness, { guard }, () => {
    assert.equal(GMGN.discoverTokenCards(() => {}), 1);
    const binding = harness.slot.__tangoQuickBuyBinding;
    const initial = {
      replacement: binding.replacement,
      binding,
      action: binding.action,
      generation: binding.generation,
      actionId: binding.actionId,
      nonce: binding.bindingNonce
    };

    harness.setNativePresentation(LIVE_QUICK_BUY_SMALL, 'color:red;border-radius:2px;');
    assert.equal(GMGN.discoverTokenCards(() => {}, 1, 'PAPER', [harness.card]), 0);

    assert.equal(harness.slot.__tangoQuickBuyBinding, initial.binding);
    assert.equal(binding.replacement, initial.replacement);
    assert.equal(binding.action, initial.action);
    assert.equal(binding.generation, initial.generation);
    assert.equal(binding.actionId, initial.actionId);
    assert.equal(binding.bindingNonce, initial.nonce);
    assert.equal(binding.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(binding.replacement.className, 'tango-list-quick-buy');
    assert.equal(binding.replacement.style.cssText, '');
  });
});
```

Extend the existing leafless, late-host, staged, ready, pending, in-flight, virtual-reuse, and two-slot tests with literal assertions for `giant` on replacement and slot. In the two-slot test, invoke each test Guard callback once and assert one callback per slot with no cross-slot invocation.

- [ ] **Step 2: Run the adapter matrix and verify RED**

Run:

```powershell
node --test --test-name-pattern="all native presentations produce one locked|native presentation mutation preserves giant|leafless|late GMGN action host|two verified slots" tests/gmgn-adapter.test.js
```

Expected: FAIL because Small/Large/Extra large still propagate into the replacement, native color/radius/custom properties are copied, and action-host geometry remains native-owned.

- [ ] **Step 3: Rewrite the headless layout gate for exact Giant geometry**

Refactor the existing headless fixture generator to emit hosts of `24`, `36`, and `48` pixels with hostile native presentations. Return the following measured fields for every slot:

```js
{
  fixture: fixture.id,
  requestedHostHeight: fixture.requestedHostHeight,
  hostHeight: host.getBoundingClientRect().height,
  slotHeight: slot.getBoundingClientRect().height,
  paper: rect(paper),
  wrapper: rect(wrapper),
  amountFont: Number.parseFloat(getComputedStyle(amount).fontSize),
  hintFont: Number.parseFloat(getComputedStyle(hint).fontSize),
  paperRadius: getComputedStyle(paper).borderRadius,
  paperColor: getComputedStyle(paper).color,
  wrapperBackground: getComputedStyle(wrapper).backgroundColor,
  centeredOffset: Math.abs(
    (paper.getBoundingClientRect().top + paper.getBoundingClientRect().height / 2)
      - (host.getBoundingClientRect().top + host.getBoundingClientRect().height / 2)
  )
}
```

Replace the four-profile headless assertion with:

```js
test('headless Chrome centers an exact 36px Tango control in short equal and tall hosts', () => {
  const report = headlessLockedGiantQuickBuyLayoutReport();
  assert.equal(report.states.length, 6, 'direct and nested fixtures x three host heights');
  for (const state of report.states) {
    assert.equal(state.paper.height, 36, `${state.fixture}:${state.requestedHostHeight}: paper height`);
    assert.ok(state.slotHeight >= 36, `${state.fixture}:${state.requestedHostHeight}: slot minimum`);
    assert.ok(state.hostHeight >= 36, `${state.fixture}:${state.requestedHostHeight}: host minimum`);
    assert.ok(state.centeredOffset <= 0.5, `${state.fixture}:${state.requestedHostHeight}: vertical center`);
    assert.equal(state.amountFont, 14, `${state.fixture}: amount font`);
    assert.equal(state.hintFont, 10, `${state.fixture}: hint font`);
    assert.equal(state.paperRadius, '6px', `${state.fixture}: Tango radius`);
    assert.equal(state.paperColor, 'rgb(125, 211, 252)', `${state.fixture}: Tango accent`);
    assert.notEqual(state.wrapperBackground, 'rgba(0, 0, 0, 0)', `${state.fixture}: painted surface`);
  }
  assert.equal(report.focus.active, true);
  assert.equal(report.focus.wrapperOutlineStyle, 'solid');
  assert.ok(report.focus.wrapperOutlineWidth >= 1);
});
```

- [ ] **Step 4: Run the headless layout test and verify RED**

Run:

```powershell
node --test --test-name-pattern="headless Chrome centers an exact 36px" tests/gmgn-adapter.test.js
```

Expected: FAIL because current CSS stretches the replacement to `height: 100%`, allows a short host to clip it, and derives color and radius from GMGN.

- [ ] **Step 5: Implement the single locked profile and presentation repair**

Replace the four profiles and all presentation caches with:

```js
const LOCKED_QUICK_BUY_PROFILE = Object.freeze({
  id: 'giant',
  heightPx: 36,
  amountTextPx: 14,
  hintTextPx: 10
});
```

Add these focused helpers:

```js
function lockedQuickBuyActionHost(slot, replacement = null) {
  const parent = replacement?.parentElement;
  if (parent?.matches?.('[class~="group/btn"]')
    && parent.closest?.('.BuyButton-continer') === slot) return parent;
  return slot?.querySelector?.('[class~="group/btn"]') || null;
}

function applyLockedQuickBuyPresentation(replacement, slot = null) {
  if (!replacement) return LOCKED_QUICK_BUY_PROFILE;
  replacement.className = 'tango-list-quick-buy';
  if (replacement.style) replacement.style.cssText = '';
  ensureInertQuickBuy(replacement);
  replacement.dataset.tangoQuickBuySize = LOCKED_QUICK_BUY_PROFILE.id;
  if (slot?.dataset) slot.dataset.tangoQuickBuySize = LOCKED_QUICK_BUY_PROFILE.id;
  const binding = slot?.__tangoQuickBuyBinding;
  const actionHost = lockedQuickBuyActionHost(slot, replacement);
  if (binding?.actionHost && binding.actionHost !== actionHost) {
    binding.actionHost.classList?.remove?.('tango-quick-buy-action-host');
  }
  actionHost?.classList?.add?.('tango-quick-buy-action-host');
  if (binding) {
    binding.actionHost = actionHost;
    binding.quickBuyProfile = LOCKED_QUICK_BUY_PROFILE;
  }
  return LOCKED_QUICK_BUY_PROFILE;
}

function syncQuickBuyPresentation(slot) {
  const binding = slot?.__tangoQuickBuyBinding;
  const replacement = binding?.replacement || slot?.__tangoReplacementQuickBuy
    || slot?.querySelector?.('.tango-list-quick-buy');
  if (!slot || !replacement?.isConnected) {
    Tango.NativeQuickBuyGuard?.revokePaperAction?.(replacement);
    return false;
  }
  applyLockedQuickBuyPresentation(replacement, slot);
  if (binding) registerPaperQuickBuy(slot, binding, binding.actionId);
  return true;
}
```

Simplify `createQuickBuyReplacement()` to create a Tango-owned button only:

```js
function createQuickBuyReplacement(
  slot, _card, _chain, _nativeControl, amountNative, paperLabel, chainDefinition
) {
  const replacement = document.createElement('button');
  replacement.type = 'button';
  const quickBuyProfile = applyLockedQuickBuyPresentation(replacement, slot);
  renderQuickBuyContent(replacement, paperLabel, amountNative, chainDefinition.nativeSymbol);
  return { replacement, quickBuyProfile };
}
```

Update every caller to destructure only `replacement` and `quickBuyProfile`. Remove binding fields `presentation`, `presentationRevision`, `presentationSignature`, `presentationComplete`, `presentationSource`, `presentationObserver`, `presentationSourceProfileId`, `presentationTrusted`, `profileObserver`, `profileSources`, `resizeObserver`, `resizeTargets`, `repairTimer`, and `repairAttempts`.

Remove `readQuickBuyPresentation()`, profile parsing, presentation cache/merge/promotion, presentation/profile observers, resize-target management, and geometry repair scheduling. Keep the page MutationObserver and health probe for structural discovery, native reinsertion, host replacement, card lifecycle, and identity repair. In `quickBuyNeedsReconcile()`, replace presentation comparisons with:

```js
if (replacement.className !== 'tango-list-quick-buy'
  || replacement.style?.cssText
  || replacement.dataset?.tangoQuickBuySize !== 'giant'
  || slot.dataset?.tangoQuickBuySize !== 'giant') return true;
```

In `restoreQuickBuySlot()`, remove the Tango action-host class before clearing the binding:

```js
binding?.actionHost?.classList?.remove?.('tango-quick-buy-action-host');
```

- [ ] **Step 6: Make CSS own exact Giant geometry and visuals**

Replace the current quick-buy geometry/profile rules in `src/content/content.css` with:

```css
.BuyButton-continer.tango-native-buy-overridden {
  align-items: center !important;
  display: flex !important;
  justify-content: center !important;
  isolation: isolate;
  min-height: 36px !important;
  min-width: 0;
  overflow: hidden;
  position: relative !important;
}

.BuyButton-continer.tango-native-buy-overridden .tango-quick-buy-action-host {
  align-items: center !important;
  display: flex !important;
  flex: 1 1 100% !important;
  justify-content: center !important;
  min-height: 36px !important;
  min-width: 0 !important;
  width: 100% !important;
}

.tango-list-quick-buy {
  --tango-quick-buy-accent: #7dd3fc;
  --tango-quick-buy-display-text: 14px;
  --tango-quick-buy-label-text: 10px;
  align-items: center !important;
  align-self: center !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 6px !important;
  box-shadow: none !important;
  box-sizing: border-box;
  color: var(--tango-quick-buy-accent) !important;
  cursor: pointer;
  display: inline-flex !important;
  flex: 0 0 auto !important;
  height: 36px !important;
  justify-content: center !important;
  max-height: 36px !important;
  min-height: 36px !important;
  min-width: 0 !important;
  outline: 0 !important;
  overflow: hidden;
  padding: 0 !important;
  pointer-events: auto !important;
  position: static !important;
  transform: none !important;
  white-space: nowrap;
  width: 100% !important;
  z-index: 1 !important;
}

.tango-quick-buy-content {
  align-items: center !important;
  background: color-mix(in srgb, var(--tango-quick-buy-accent) 16%, transparent) !important;
  border-radius: 6px !important;
  box-sizing: border-box;
  display: inline-flex !important;
  flex: 1 1 100% !important;
  flex-direction: column !important;
  font-size: var(--tango-quick-buy-display-text) !important;
  gap: 0 !important;
  height: 100% !important;
  justify-content: center !important;
  line-height: .9 !important;
  max-height: 100% !important;
  max-width: 100% !important;
  min-height: 0 !important;
  min-width: 0 !important;
  overflow: hidden;
  padding: 0 2px !important;
  pointer-events: none !important;
  width: 100% !important;
}

.tango-list-quick-buy:hover .tango-quick-buy-content {
  background: color-mix(in srgb, var(--tango-quick-buy-accent) 24%, transparent) !important;
}

.tango-list-quick-buy:focus-visible .tango-quick-buy-content {
  outline: 1px solid var(--tango-quick-buy-accent) !important;
  outline-offset: -1px !important;
}
```

Keep the current `.tango-paper-hint`, `.tango-buy-amount`, hover brightness, active opacity, and in-flight cursor rules, but remove the Small/Large/Extra large/Giant selector table and every `--customize-button-ultra-color` reference from Tango quick-buy rules.

- [ ] **Step 7: Run adapter, layout, and structure suites and verify GREEN**

Run:

```powershell
node --test tests/gmgn-adapter.test.js
node --test tests/content-structure.test.js
```

Expected: PASS; every fixture reports `giant`, exact 36px geometry, 14px/10px typography, fixed Tango visuals, unchanged binding/action identity, separate callbacks for two slots, and zero native callbacks.

- [ ] **Step 8: Commit the locked Giant UI**

```powershell
git add tests/gmgn-adapter.test.js tests/content-structure.test.js src/adapters/gmgn.js src/content/content.css
git commit -m "feat: lock trench quick buy to Tango giant UI"
```

---

### Task 3: Require Trusted Events at Every Shell Mutation Entry

**Files:**
- Modify: `tests/content-runtime.test.js:287-549,1523-1538,1931-2036,2142-2154,5757-5770`
- Modify: `src/content/content.js:36-46,1539-1870,2021-2031,2332-2436`

**Interfaces:**
- Consumes: real browser DOM events delivered inside the isolated world and existing internal functions `buy`, `sell`, `sellPosition`, `sellBreakeven`, `requestCloseAll`, `savePresetEdits`, `patchRuntimeSettings`, and modal action closures.
- Produces: `requireTrustedUserEvent(event) -> boolean`, used by the shell capture gate and again by each mutation-capable handler.
- Produces: isolated `WeakSet` provenance for a session-suppression checkbox changed by a trusted event.
- Preserves: extension-internal initialization, refresh, modal action functions, Guard quick-buy callbacks, and direct internal calls in unit tests; these do not manufacture DOM events.

- [ ] **Step 1: Upgrade the test event harness and write failing synthetic-mutation tests**

Change `eventElement()` so it can host every handler registered by production:

```js
function eventElement({ dataset = {}, value = '', checked = false } = {}) {
  const listeners = new Map();
  return {
    dataset, value, checked, style: {},
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== listener));
    },
    emit(type, event = {}) {
      let result;
      for (const listener of listeners.get(type) || []) result = listener(event);
      return result;
    }
  };
}
```

Make the fake shell store capture listeners:

```js
const shellListeners = new Map();
const shell = {
  className: '', innerHTML: '',
  addEventListener(type, listener, options) {
    const entries = shellListeners.get(type) || [];
    entries.push({ listener, options });
    shellListeners.set(type, entries);
  },
  querySelectorAll(selector) { return shellLists.get(selector) || []; },
  querySelector() { return null; }
};
```

Expose `shellListeners` from `loadContent()`, then add:

```js
test('synthetic shell events cannot buy sell close confirm or patch settings', async () => {
  const loaded = loadContent();
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.runtime.current = quoteContext();
  loaded.api.rememberNativePrice('eth', 2_000, loaded.clock.now);
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 1,
    costBasisNative: 1, averageEntryPriceUsd: 2, lastPriceUsd: 2,
    lastNativePriceUsd: 2_000, quoteObservedAt: loaded.clock.now
  };
  let modalActions = 0;
  loaded.api.runtime.modal = { type: 'confirm', action: () => { modalActions += 1; } };

  const buyButton = eventElement({ dataset: { buy: '1' } });
  const sellButton = eventElement({ dataset: { sell: '100' } });
  const closeAll = eventElement({ dataset: { action: 'close-all' } });
  const confirm = eventElement({ dataset: { action: 'confirm-modal' } });
  const collapse = eventElement({ dataset: { action: 'collapse-panel' } });
  loaded.shellLists.set('[data-buy]', [buyButton]);
  loaded.shellLists.set('[data-sell]', [sellButton]);
  loaded.shellLists.set('[data-action]', [closeAll, confirm, collapse]);
  loaded.api.bindEvents();

  const synthetic = {
    isTrusted: false,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  };
  await buyButton.emit('click', synthetic);
  await sellButton.emit('click', synthetic);
  await closeAll.emit('click', synthetic);
  await confirm.emit('click', synthetic);
  await collapse.emit('click', synthetic);

  assert.equal(loaded.calls.buy, 0);
  assert.equal(loaded.calls.sell, 0);
  assert.equal(loaded.calls.closeAll, 0);
  assert.equal(loaded.calls.patches.length, 0);
  assert.equal(modalActions, 0);
});

test('synthetic preset save drag and confirmation suppression cannot persist', async () => {
  const loaded = loadContent();
  const save = eventElement({ dataset: { action: 'save-presets' } });
  const editor = eventElement();
  const confirm = eventElement({ dataset: { action: 'confirm-modal' } });
  const checkbox = eventElement({ checked: true });
  loaded.shellLists.set('[data-action]', [save, confirm]);
  loaded.shellLists.set('.tango-preset-editor', [editor]);
  loaded.shadowSingles.set('#tango-skip-session-confirm', checkbox);
  setPresetInputs(loaded);
  loaded.api.runtime.modal = { type: 'confirm', allowSessionSuppress: true, action: async () => undefined };
  loaded.api.bindEvents();

  const synthetic = {
    isTrusted: false, key: 'Enter',
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  };
  checkbox.emit('change', synthetic);
  await save.emit('click', synthetic);
  await editor.emit('keydown', synthetic);
  await confirm.emit('click', synthetic);

  assert.equal(loaded.calls.patches.length, 0);
  assert.equal(loaded.messages.some((message) => message.type === 'TANGO_SET_SESSION_CONFIRM'), false);
  assert.equal(loaded.api.runtime.suppressConfirmForSession, false);
});
```

- [ ] **Step 2: Run synthetic shell tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="synthetic shell events|synthetic preset save drag" tests/content-runtime.test.js
```

Expected: FAIL because current handlers do not inspect `event.isTrusted`, synthetic confirmation invokes its modal closure, and synthetic settings actions persist patches.

- [ ] **Step 3: Add failing trusted keyboard, click, drag, and session-suppression coverage**

Add `isTrusted: true` to all existing positive event fixtures. Add:

```js
test('trusted click keyboard drag and confirmation suppression preserve existing behavior', async () => {
  const loaded = loadContent();
  const save = eventElement({ dataset: { action: 'save-presets' } });
  const editor = eventElement();
  const confirm = eventElement({ dataset: { action: 'confirm-modal' } });
  const checkbox = eventElement({ checked: true });
  loaded.shellLists.set('[data-action]', [save, confirm]);
  loaded.shellLists.set('.tango-preset-editor', [editor]);
  loaded.shadowSingles.set('#tango-skip-session-confirm', checkbox);
  setPresetInputs(loaded);
  loaded.api.runtime.modal = { type: 'confirm', allowSessionSuppress: true, action: async () => undefined };
  loaded.api.bindEvents();

  const trusted = {
    isTrusted: true,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  };
  checkbox.emit('change', trusted);
  await editor.emit('keydown', { ...trusted, key: 'Enter' });
  await confirm.emit('click', trusted);

  assert.equal(loaded.calls.patches.length, 1);
  assert.equal(loaded.messages.some((message) => (
    message.type === 'TANGO_SET_SESSION_CONFIRM' && message.suppressed === true
  )), true);
  assert.equal(loaded.api.runtime.suppressConfirmForSession, true);
});
```

Update the existing drag persistence test so pointerdown, pointermove, and pointerup each use `isTrusted: true`. Add one negative drag case whose synthetic pointerdown never installs global move/up handlers and whose synthetic move/up during a trusted drag cannot change or persist the position.

- [ ] **Step 4: Run trusted behavior tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="trusted click keyboard drag|drag persistence|preset Enter handler" tests/content-runtime.test.js
```

Expected: FAIL because no isolated checkbox provenance exists and current event helpers do not enforce the new trusted contract consistently.

- [ ] **Step 5: Implement the capture gate and handler-local checks**

Immediately after shell construction in `src/content/content.js`, add:

```js
const trustedSessionSuppressInputs = new WeakSet();

function requireTrustedUserEvent(event) {
  if (event?.isTrusted === true) return true;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  event?.stopImmediatePropagation?.();
  return false;
}

function blockUntrustedShellEvent(event) {
  requireTrustedUserEvent(event);
}

for (const type of ['click', 'keydown', 'change', 'pointerdown']) {
  shell.addEventListener(type, blockUntrustedShellEvent, { capture: true, passive: false });
}

shell.addEventListener('pointerdown', (event) => {
  if (event.isTrusted === true) runtime.interactionUntil = Date.now() + 500;
}, true);
```

Update `renderHeaderAccountSummary()` handlers:

```js
node.onclick = (event) => {
  if (!requireTrustedUserEvent(event)) return;
  event.preventDefault();
  event.stopPropagation();
  runtime.calendarOpen = !runtime.calendarOpen;
  render();
};
node.onkeydown = (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (!requireTrustedUserEvent(event)) return;
  event.preventDefault();
  runtime.calendarOpen = !runtime.calendarOpen;
  render();
};
```

At the beginning of every click handler created in `bindEvents()`, require the event:

```js
shell.querySelectorAll('[data-buy]').forEach((button) => button.addEventListener('click', (event) => {
  if (!requireTrustedUserEvent(event)) return;
  return buy(Number(button.dataset.buy));
}));
shell.querySelectorAll('[data-sell]').forEach((button) => button.addEventListener('click', (event) => {
  if (!requireTrustedUserEvent(event)) return;
  return sell(Number(button.dataset.sell));
}));
shell.querySelectorAll('[data-position-open]').forEach((button) => button.addEventListener('click', (event) => {
  if (!requireTrustedUserEvent(event)) return;
  const position = runtime.state.positions[button.dataset.key];
  if (position) openPosition(position);
}));
shell.querySelectorAll('[data-position-sell]').forEach((button) => button.addEventListener('click', (event) => {
  if (!requireTrustedUserEvent(event)) return;
  const position = runtime.state.positions[button.dataset.key];
  if (position) return sellPosition(position, Number(button.dataset.positionSell));
}));
```

Keep the existing `data-action` branches, but insert this before reading `element.dataset.action`:

```js
if (!requireTrustedUserEvent(event)) return;
event.stopPropagation();
```

Bind trusted provenance for the session checkbox and consume it in `confirm-modal`:

```js
const sessionSuppressInput = shadow.querySelector('#tango-skip-session-confirm');
sessionSuppressInput?.addEventListener('change', (event) => {
  if (!requireTrustedUserEvent(event)) {
    sessionSuppressInput.checked = false;
    trustedSessionSuppressInputs.delete(sessionSuppressInput);
    return;
  }
  if (sessionSuppressInput.checked) trustedSessionSuppressInputs.add(sessionSuppressInput);
  else trustedSessionSuppressInputs.delete(sessionSuppressInput);
});
```

Replace the suppression read in the confirmation branch with:

```js
const sessionSuppressInput = shadow.querySelector('#tango-skip-session-confirm');
const suppressForSession = Boolean(
  runtime.modal?.allowSessionSuppress
  && sessionSuppressInput?.checked
  && trustedSessionSuppressInputs.has(sessionSuppressInput)
);
```

Gate preset keyboard saves:

```js
shell.querySelectorAll('.tango-preset-editor').forEach((input) => input.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter' || !requireTrustedUserEvent(event)) return;
  await savePresetEdits();
}));
```

In `bindDraggable()`, add strict checks to all three phases:

```js
handle.addEventListener('pointerdown', (event) => {
  if (!requireTrustedUserEvent(event) || event.target.closest('button')) return;
  const rect = element.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const fallbackSettings = { ...runtime.settings, [settingKey]: runtime.settings[settingKey] };
  let dragged = false;
  const onMove = (move) => {
    if (move?.isTrusted !== true) return;
    if (!dragged && Math.hypot(move.clientX - startX, move.clientY - startY) < 5) return;
    dragged = true;
    move.preventDefault();
    const position = {
      x: Math.min(Math.max(0, innerWidth - rect.width), Math.max(0, rect.left + move.clientX - startX)),
      y: Math.min(Math.max(0, innerHeight - rect.height), Math.max(0, rect.top + move.clientY - startY))
    };
    runtime.settings = { ...runtime.settings, [settingKey]: position };
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.transform = 'none';
  };
  const onUp = async (up) => {
    if (up?.isTrusted !== true) return;
    global.removeEventListener('pointermove', onMove);
    global.removeEventListener('pointerup', onUp);
    global.removeEventListener('pointercancel', onUp);
    if (!dragged) return;
    const suppressClick = (click) => {
      click.preventDefault();
      click.stopImmediatePropagation();
    };
    element.addEventListener('click', suppressClick, true);
    setTimeout(() => element.removeEventListener('click', suppressClick, true), 0);
    await patchRuntimeSettings({ [settingKey]: runtime.settings[settingKey] }, fallbackSettings);
  };
  global.addEventListener('pointermove', onMove);
  global.addEventListener('pointerup', onUp);
  global.addEventListener('pointercancel', onUp);
});
```

- [ ] **Step 6: Run content runtime tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="synthetic shell events|synthetic preset save drag|trusted click keyboard drag|preset click|collapse and sound|drag persistence|preset Enter|PnL calendar" tests/content-runtime.test.js
```

Expected: PASS; synthetic events produce no trade, state, settings, layout, confirmation, or session mutation, while trusted click, keyboard, and drag paths preserve existing behavior.

- [ ] **Step 7: Commit the shell trusted-event boundary**

```powershell
git add tests/content-runtime.test.js src/content/content.js
git commit -m "fix: require trusted shell mutations"
```

---

### Task 4: Keep MAIN-World Quote Observations Ephemeral

**Files:**
- Modify: `tests/content-runtime.test.js:1360-1469,3682-3776,4819-4881,4899-4970,5720-5755`
- Modify: `src/content/content.js:257-342`

**Interfaces:**
- Consumes: `TANGO_GMGN_PAGE` `NATIVE_PRICES` and `TOKEN_QUOTES` messages after existing source, chain, address, time, and provenance validation.
- Produces: bounded updates to `runtime.nativePrices`, `runtime.nativePriceObservedAt`, `runtime.gmgnQuotes`, current display context, render scheduling, and marker replay only.
- Preserves: click-time quote commitment inside a genuine Guard-authorized paper transaction.
- Preserves: persistent automatic calibration from the existing extension/background native-price and token-quote channels and normal quote ticks.
- Removes: metadata persistence and calibration scheduling directly caused by MAIN-world page messages.

- [ ] **Step 1: Write failing page-message non-persistence tests**

Add:

```js
test('page TOKEN_QUOTES remain ephemeral and cannot persist metadata or calibration', async () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  const key = `eth:${ADDRESS_A}`;
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[key] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'OLD', name: 'Old', quantity: 1,
    costBasisNative: 1, averageEntryPriceUsd: 1, lastPriceUsd: 1,
    lastNativePriceUsd: 2_000, quoteObservedAt: loaded.clock.now - 1,
    totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    needsCalibration: true, provisional: true, syntheticTokenPrice: true
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'eth', address: ADDRESS_A, priceUsd: 2, marketCapUsd: 2_000,
      symbol: 'PAGE', name: 'Page Token', logoUrl: 'page.png',
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK',
      priceProvenance: 'OBSERVED_PRICE'
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.api.runtime.gmgnQuotes.get(key).priceUsd, 2);
  assert.equal(loaded.calls.metadataBatches.length, 0);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
  assert.equal(loaded.api.runtime.state.positions[key].symbol, 'OLD');
});

test('page NATIVE_PRICES cannot schedule delayed calibration', async () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  const key = `eth:${ADDRESS_A}`;
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[key] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 1,
    costBasisNative: 1, averageEntryPriceUsd: 1, lastPriceUsd: 1,
    lastNativePriceUsd: 1, quoteObservedAt: loaded.clock.now - 1,
    needsCalibration: true, provisional: true,
    syntheticNativePrice: true, provisionalNativePrice: true
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES',
    prices: [{ symbol: 'ETH', priceUsd: 2_000, observedAt: loaded.clock.now }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.api.runtime.nativePrices.get('eth'), 2_000);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
});
```

Replace the old page-message metadata test with the first assertion set above. Change `a stronger native observation during supply calibration reruns immediately after settlement` so its stronger observation comes from `ensureNativePrice()` with a background `TANGO_GET_NATIVE_PRICE` response, not from `dispatchPageMessage()`.

- [ ] **Step 2: Run the page-message tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="page TOKEN_QUOTES remain ephemeral|page NATIVE_PRICES cannot schedule" tests/content-runtime.test.js
```

Expected: FAIL because current TOKEN_QUOTES calls `updatePositionMetadataBatch` and queues calibration, while NATIVE_PRICES also queues calibration.

- [ ] **Step 3: Keep only ephemeral side effects in `handlePageMessage()`**

In the NATIVE_PRICES branch, retain caching and rendering but remove calibration:

```js
if (event.source === window && event.data?.source === 'TANGO_GMGN_PAGE'
  && event.data?.type === 'NATIVE_PRICES') {
  for (const price of event.data.prices || []) {
    Tango.Chains.all().filter((chain) => chain.nativeSymbol === price.symbol)
      .forEach((chain) => rememberNativePrice(chain.id, price.priceUsd, price.observedAt));
  }
  queueRender();
  return;
}
```

In the TOKEN_QUOTES branch, remove the `positionsByAddress` and
`metadataUpdates` declarations. Inside the quote loop, remove the exact block
from `const position = positionsByAddress.get(address);` through the matching
`metadataUpdates.push(...)` call. After the edit, both identifier names must be
absent from `handlePageMessage()`:

```powershell
$matches = rg -n "positionsByAddress|metadataUpdates" src/content/content.js
if ($LASTEXITCODE -eq 0) {
  $matches | ForEach-Object { Write-Error $_ }
  exit 1
}
if ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }
```

Keep the current cache validation, merge, current-token update, bounded 2,000-entry eviction, chart-marker publication, and render scheduling. Replace the tail with:

```js
if (currentQuoteChanged) {
  publishChartMarkers();
  queueRender();
}
```

Do not call `queueImmediateCurrentCalibration()` or any `Tango.Store` method from either MAIN-world message branch.

- [ ] **Step 4: Prove the extension/background path still calibrates**

Retain or add this focused positive test using the existing `loadContent({ sendMessage })` harness:

```js
test('background native response still persists an eligible calibration', async () => {
  let loaded;
  loaded = loadContent({
    href: `https://gmgn.ai/eth/token/${ADDRESS_A}`,
    sendMessage(message) {
      if (message.type === 'TANGO_GET_NATIVE_PRICE') {
        return Promise.resolve({ ok: true, price: 2_000, observedAt: loaded.clock.now });
      }
      return Promise.resolve({ ok: true });
    }
  });
  const key = `eth:${ADDRESS_A}`;
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[key] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 1,
    costBasisNative: 1, averageEntryPriceUsd: 1, lastPriceUsd: 1,
    lastNativePriceUsd: 1, quoteObservedAt: loaded.clock.now - 1,
    needsCalibration: true, provisional: true,
    syntheticNativePrice: true, provisionalNativePrice: true
  };

  loaded.api.ensureNativePrice(loaded.api.runtime.current);
  await loaded.api.runtime.nativePricePromises.get('eth');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.api.runtime.nativePrices.get('eth'), 2_000);
  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.nativePriceUsd, 2_000);
});
```

- [ ] **Step 5: Run ephemeral and background-channel tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="page TOKEN_QUOTES remain ephemeral|page NATIVE_PRICES cannot schedule|background native response still persists|page-message quote caching" tests/content-runtime.test.js
```

Expected: PASS; page messages update only bounded runtime caches and display state, while the extension/background response still persists one eligible calibration.

- [ ] **Step 6: Commit the ephemeral quote boundary**

```powershell
git add tests/content-runtime.test.js src/content/content.js
git commit -m "fix: keep page quotes out of persistent state"
```

---

### Task 5: Full Regression, Package Parity, and Permission Audit

**Files:**
- Verify unchanged: `manifest.json`
- Regenerate: `dist/tango-paper-trader/src/content/native-quick-buy-guard.js`
- Regenerate: `dist/tango-paper-trader/src/content/page-main.js`
- Regenerate: `dist/tango-paper-trader/src/content/content.js`
- Regenerate: `dist/tango-paper-trader/src/content/content.css`
- Regenerate: `dist/tango-paper-trader/src/adapters/gmgn.js`

**Interfaces:**
- Consumes: all source and test changes from Tasks 1-4.
- Produces: packaged runtime files byte-identical to their source counterparts and a passing extension validation.
- Preserves: permissions exactly `storage` plus the existing GMGN, CoinGecko, and Dexscreener host permissions.

- [ ] **Step 1: Run every focused security and UI suite**

```powershell
node --test tests/native-quick-buy-guard.test.js tests/gmgn-quick-buy-world-integration.test.js tests/page-main.test.js
node --test tests/gmgn-adapter.test.js
node --test tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: PASS with no skipped locked-Giant, trusted-activation, shell-mutation, or ephemeral-quote regression.

- [ ] **Step 2: Run the entire project test suite**

```powershell
npm.cmd test
```

Expected: PASS for every `tests/*.test.js` file with zero failures.

- [ ] **Step 3: Build packaged runtime assets**

```powershell
npm.cmd run build
```

Expected: exit code `0`; build refreshes the five listed `dist` runtime assets without changing manifest permissions.

- [ ] **Step 4: Validate extension structure and permissions**

```powershell
npm.cmd run check
```

Expected: exit code `0`; the validator accepts manifest ordering, source references, package parity, and paper-only permission boundaries.

- [ ] **Step 5: Verify source and packaged runtime byte parity**

```powershell
$pairs = @(
  @('src/content/native-quick-buy-guard.js', 'dist/tango-paper-trader/src/content/native-quick-buy-guard.js'),
  @('src/content/page-main.js', 'dist/tango-paper-trader/src/content/page-main.js'),
  @('src/content/content.js', 'dist/tango-paper-trader/src/content/content.js'),
  @('src/content/content.css', 'dist/tango-paper-trader/src/content/content.css'),
  @('src/adapters/gmgn.js', 'dist/tango-paper-trader/src/adapters/gmgn.js')
)
foreach ($pair in $pairs) {
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pair[0]).Hash
  $distHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pair[1]).Hash
  if ($sourceHash -ne $distHash) { throw "Package mismatch: $($pair[0])" }
}
```

Expected: command completes without throwing; every source hash equals its packaged counterpart.

- [ ] **Step 6: Audit the manifest permission boundary**

```powershell
$manifest = Get-Content -Raw -LiteralPath 'manifest.json' | ConvertFrom-Json
if (($manifest.permissions -join ',') -ne 'storage') { throw 'Unexpected extension permission' }
if ($manifest.permissions -contains 'unlimitedStorage') { throw 'unlimitedStorage must remain absent' }
$guardScript = $manifest.content_scripts | Where-Object { $_.js -contains 'src/content/native-quick-buy-guard.js' }
if ($guardScript.run_at -ne 'document_start' -or $guardScript.world) {
  throw 'Guard must remain a document-start isolated-world script'
}
```

Expected: command completes without throwing; no new privileged capability exists.

- [ ] **Step 7: Commit package parity**

```powershell
git add dist/tango-paper-trader/src/content/native-quick-buy-guard.js dist/tango-paper-trader/src/content/page-main.js dist/tango-paper-trader/src/content/content.js dist/tango-paper-trader/src/content/content.css dist/tango-paper-trader/src/adapters/gmgn.js
git commit -m "build: refresh trusted quick buy package"
```

## Execution Notes

- Execute tasks sequentially because Tasks 1 and 2 both reshape `src/adapters/gmgn.js` and its test harness.
- In Task 1, test failure must come from missing opaque callback authority, not a malformed fake event or missing binding field.
- In Task 2, remove approved-spec-incompatible four-profile assertions before running RED so the expected failure is the new Giant behavior.
- In Task 3, direct calls to internal test exports remain valid; the security boundary is every page-reachable DOM event entry.
- In Task 4, an ephemeral quote may affect the next genuine click-time decision, but it cannot cause an autonomous persistent write.
- Do not click a real or paper GMGN trading control during manual inspection.
