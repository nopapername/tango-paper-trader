# GMGN Always-Clickable Paper Quick-Buy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every visible GMGN trench paper quick-buy control safely clickable across React rerenders and size changes, and make every valid-address paper trade execute deterministically without K-line or market data while preserving correct 1B/2B/100B arithmetic.

**Architecture:** Split event safety into an isolated-world core identity plus a refreshable native-ancestor envelope, and publish each adapter binding atomically with an immutable nonce/card generation before MAIN-world activation is accepted. Resolve token price, supply, and native price independently; calibrate only representation dimensions before buy/sell, while leaving genuine token-price movement as paper PnL.

**Tech Stack:** Chrome Manifest V3, isolated-world and MAIN-world content scripts, plain JavaScript, Node.js built-in test runner, PowerShell release verification.

## Global Constraints

- Never click or dispatch a GMGN native buy/sell control, wallet prompt, signature, approval, swap, RPC broadcast, or any other real-money action.
- A permitted paper activation must invoke exactly one Tango paper callback and zero GMGN/native callbacks at capture and bubble levels.
- A visible `.tango-list-quick-buy` must not use the native `disabled` attribute in `resolving-identity`, `ready`, or `in-flight` state.
- An addressless click is an intent only. It cannot call the trading engine and expires after exactly 2,000 ms.
- Address evidence must come from the same card generation and same-chain GMGN or approved launchpad href; a network quote alone cannot bind an addressless card.
- Token price, supply, and native price are selected independently. A trustworthy token price always wins even when exact supply is absent.
- Supply order is GMGN exact, then a verified launchpad rule, then unknown 1B. Missing price uses market cap divided by that supply, then `$3,200` divided by that supply.
- Missing native price uses a synthetic paper value of `$1` until a trustworthy exact-chain observation arrives.
- Pump.fun standard is 1B, Pump.fun Mayhem is 2B, Bankr/Banker/Bankr.bot/Clanker on Base and Robinhood is 100B, Four.meme/Flap/Zora/DYOR/Bow is 1B, and unknown is 1B.
- Supply/native corrections are neutral. A real token-price movement in the same observation remains ordinary PnL.
- Historical BUY/SELL records are immutable; neutral changes are separate calibration events.
- Preserve all existing staged and unstaged changes. Do not stage, commit, reset, clean, switch branches, or overwrite unrelated work.
- Source files are authoritative. Build `dist/tango-paper-trader` only after all source tests and validators pass.

## Current Baseline

- Focused source suite on 2026-08-01: 384 tests passed across Guard, adapter, content runtime, Engine, Supply, and markers.
- The passing baseline lacks React ancestor self-heal, atomic registration failure, addressless-intent generation, real-price-plus-supply-upgrade, and owned-wrapper geometry coverage.

---

### Task 1: Cross-world activation identity and Guard self-healing

**Files:**
- Modify: `src/content/native-quick-buy-guard.js:35-143`
- Modify: `src/content/page-main.js:5-102`
- Modify: `tests/native-quick-buy-guard.test.js:119-374`
- Modify: `tests/page-main.test.js:93-470`
- Create: `tests/gmgn-quick-buy-world-integration.test.js`

**Interfaces:**
- Consumes: shared DOM attributes written by the adapter.
- Produces:

```js
NativeQuickBuyGuard.registerPaperAction(element, {
  slot, card, binding, actionId, bindingNonce, generation, state,
  chain, address, href, amountNative
}): boolean

NativeQuickBuyGuard.isPaperActionTrusted(element, {
  slot, card, binding, actionId, bindingNonce, generation, state,
  chain, address, href, amountNative
}): boolean

NativeQuickBuyGuard.revokePaperAction(element): boolean

// MAIN-world message payloads
{ source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_INTENT', actionId, bindingNonce }
{ source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK', actionId, bindingNonce }
```

Test helpers added in this task:

```js
function paperIdentity(loaded, actionId, patch = {}) {
  const address = '0x1111111111111111111111111111111111111111';
  const element = new loaded.FakeElement(['[data-tango-paper-action="quick-buy"]']);
  const slot = new loaded.FakeElement(['.BuyButton-continer']);
  const card = new loaded.FakeElement(['[class~="group/a"]']);
  const state = patch.state || 'ready';
  const generation = Number(patch.generation || 1);
  const bindingNonce = patch.bindingNonce || `nonce-${generation}`;
  const binding = {
    replacement: element, slot, card, actionId, bindingNonce, generation, state,
    chain: 'base', address, href: `https://gmgn.ai/base/token/${address}`,
    amountNative: 1
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
    element, slot, card, binding, actionId, bindingNonce, generation, state,
    chain: binding.chain, address: binding.address, href: binding.href,
    amountNative: binding.amountNative
  };
}

function makePaper(loaded, { actionId, bindingNonce, state }) {
  const button = new loaded.context.Element();
  button.dataset = {
    tangoActionId: actionId,
    tangoBindingNonce: bindingNonce,
    tangoPaperState: state
  };
  button.matches = (selector) => selector === '[data-tango-paper-action="quick-buy"]';
  return button;
}

function dispatchPaper(loaded, type, button, overrides = {}) {
  return dispatchCaptured(loaded, {
    type, target: button, button: 0, isPrimary: true, pointerId: 1,
    detail: type === 'click' ? 1 : 0, isTrusted: true,
    composedPath: () => [button], ...overrides
  });
}

function dispatchCaptured(loaded, event) {
  const state = { prevented: false, stopped: false, immediate: false };
  Object.assign(event, {
    preventDefault: () => { state.prevented = true; },
    stopPropagation: () => { state.stopped = true; },
    stopImmediatePropagation: () => { state.immediate = true; }
  });
  for (const entry of loaded.listenerRegistrations
    .filter((candidate) => candidate.type === event.type && candidate.options?.capture)) {
    if (!state.immediate) entry.listener(event);
  }
  return state;
}
```

`loadIntegratedQuickBuyWorld()` is defined in the new integration file by reusing the existing
`FakeElement` tree from `tests/native-quick-buy-guard.test.js` and the capture/bubble dispatcher
from `tests/page-main.test.js`. It returns the exact methods used below:
`mountReadyPaper`, `replaceNativeAncestor`, `dispatchTrusted`, `dispatchTrustedPair`, and
`mutateCore`, plus `paperOrders`, `nativeCaptureCalls`, and `nativeBubbleCalls` counters.

- [ ] **Step 1: Replace the old immutable-ancestor expectation with a failing ancestor-envelope self-heal test**

Add to `tests/native-quick-buy-guard.test.js` and retain the existing core-drift table:

```js
test('ancestor-only React remount self-heals while exact core drift remains fail-closed', () => {
  const loaded = loadGuard(new Promise(() => {}));
  const guard = loaded.context.Tango.NativeQuickBuyGuard;
  const identity = paperIdentity(loaded, 'paper-react-remount', {
    bindingNonce: 'nonce-1', generation: 1, state: 'ready'
  });
  const rootA = new loaded.FakeElement(['[data-sentry-component="BuyButtons"]']);
  const rootB = new loaded.FakeElement(['[data-sentry-component="BuyButtons"]']);
  rootA.appendChild(identity.card);
  assert.equal(guard.registerPaperAction(identity.element, identity), true);

  rootA.removeChild(identity.card);
  rootB.appendChild(identity.card);
  assertAllowed(loaded.dispatch('click', [
    identity.element, identity.slot, identity.card, rootB
  ]));
  assert.equal(guard.isPaperActionTrusted(identity.element, identity), true);

  identity.element.dataset.tangoBindingNonce = 'page-spoof';
  assertBlocked(loaded.dispatch('click', [
    identity.element, identity.slot, identity.card, rootB
  ]));
  identity.element.dataset.tangoBindingNonce = identity.bindingNonce;
  assert.equal(guard.isPaperActionTrusted(identity.element, identity), false);
});
```

- [ ] **Step 2: Add failing MAIN-world nonce/state and exact semantic-target tests**

Extend `tests/page-main.test.js` so pointer/key state is keyed by the full activation identity:

```js
test('paper activation requires one exact action nonce and state from down through up', () => {
  const loaded = loadPageMain(async () => jsonResponse({}), { now: 1_000 });
  const button = makePaper(loaded, {
    actionId: 'action-1', bindingNonce: 'nonce-1', state: 'ready'
  });
  dispatchPaper(loaded, 'pointerdown', button, { pointerId: 7 });
  button.dataset.tangoBindingNonce = 'nonce-2';
  dispatchPaper(loaded, 'pointerup', button, { pointerId: 7 });
  assert.deepEqual(loaded.paperPublished, []);

  button.dataset.tangoBindingNonce = 'nonce-3';
  button.dataset.tangoPaperState = 'resolving-identity';
  dispatchPaper(loaded, 'click', button, { target: button, detail: 0, isTrusted: true });
  assert.deepEqual(loaded.paperPublished, [{
    source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_INTENT',
    actionId: 'action-1', bindingNonce: 'nonce-3'
  }]);

  const child = new loaded.context.Element();
  child.parentElement = button;
  dispatchPaper(loaded, 'click', button, {
    target: child, composedPath: () => [child, button], detail: 0, isTrusted: true
  });
  assert.equal(loaded.paperPublished.length, 1);
});
```

- [ ] **Step 3: Add a failing integrated Guard -> MAIN -> adapter event harness**

Create `tests/gmgn-quick-buy-world-integration.test.js` with one shared fake DOM and separate `vm` contexts. Load scripts in manifest order and use sentinel listeners on every native ancestor:

```js
test('React ancestor replacement never exposes a native callback or duplicates paper activation', () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountReadyPaper({
    chain: 'base', address: EVM_ADDRESS, amountNative: 1
  });

  world.replaceNativeAncestor(mounted.slot, 'before-down');
  world.dispatchTrusted('pointerdown', mounted.paper, { pointerId: 11 });
  world.replaceNativeAncestor(mounted.slot, 'between-down-up');
  world.dispatchTrusted('pointerup', mounted.paper, { pointerId: 11 });
  world.replaceNativeAncestor(mounted.slot, 'after-activation');

  assert.equal(world.paperOrders.length, 1);
  assert.equal(world.nativeCaptureCalls, 0);
  assert.equal(world.nativeBubbleCalls, 0);
});

for (const drift of ['actionId', 'bindingNonce', 'card', 'slot', 'chain', 'address']) {
  test(`core ${drift} drift blocks both paper and native callbacks`, () => {
    const world = loadIntegratedQuickBuyWorld();
    const mounted = world.mountReadyPaper({ chain: 'base', address: EVM_ADDRESS });
    world.mutateCore(mounted, drift);
    world.dispatchTrustedPair(mounted.paper);
    assert.equal(world.paperOrders.length, 0);
    assert.equal(world.nativeCaptureCalls + world.nativeBubbleCalls, 0);
  });
}
```

- [ ] **Step 4: Run the new activation tests and verify RED**

Run:

```powershell
node --test tests/native-quick-buy-guard.test.js tests/page-main.test.js tests/gmgn-quick-buy-world-integration.test.js
```

Expected: ancestor-only remount is blocked, nonce/state payload assertions fail, and the integrated harness cannot complete a safe paper activation. Existing spoof/core-drift tests must remain green.

- [ ] **Step 5: Split Guard validation into core identity and ancestor envelope**

Implement these internal functions in `src/content/native-quick-buy-guard.js`:

```js
function currentPaperCoreIdentity(element, identity) {
  const bindingNonce = String(identity?.bindingNonce || '');
  const state = String(identity?.state || '');
  return element instanceof global.Element
    && identity?.element === element
    && identity?.slot instanceof global.Element
    && identity?.card instanceof global.Element
    && identity?.binding
    && identity.binding.replacement === element
    && identity.binding.actionId === identity.actionId
    && identity.binding.bindingNonce === bindingNonce
    && identity.binding.generation === identity.generation
    && identity.binding.state === state
    && identity.binding.chain === identity.chain
    && identity.binding.address === identity.address
    && identity.binding.href === identity.href
    && Number(identity.binding.amountNative) === Number(identity.amountNative)
    && ['resolving-identity', 'ready', 'in-flight'].includes(state)
    && element.dataset?.tangoPaperAction === 'quick-buy'
    && element.dataset?.tangoActionId === identity.actionId
    && element.dataset?.tangoBindingNonce === bindingNonce
    && element.dataset?.tangoCardGeneration === String(identity.generation)
    && element.dataset?.tangoPaperState === state
    && identity.slot.dataset?.tangoActionId === identity.actionId
    && identity.slot.dataset?.tangoBindingNonce === bindingNonce
    && identity.slot.dataset?.tangoCardGeneration === String(identity.generation)
    && identity.slot.__tangoQuickBuyBinding === identity.binding
    && identity.slot.__tangoReplacementQuickBuy === element
    && identity.slot.contains?.(element) === true
    && identity.slot.__tangoQuickBuyCard === identity.card
    && identity.card.contains?.(identity.slot) === true
    && element.isConnected === true
    && identity.slot.isConnected === true
    && identity.card.isConnected === true;
}

function pathAuthorizesPaper(elements, identity) {
  const paperIndex = elements.indexOf(identity.element);
  const slotIndex = elements.indexOf(identity.slot);
  if (paperIndex < 0 || slotIndex <= paperIndex) return false;
  return elements.slice(paperIndex + 1, slotIndex).every((element) => !isNativeQuickBuy(element));
}
```

When core identity is exact and only the recorded ancestor envelope changed, replace the WeakMap descriptor with a new frozen descriptor containing `captureNativeAncestors(slot)` and authorize that same event. Any core drift revokes and blocks.

`isPaperActionTrusted` performs no event-path self-heal: it returns true only when core identity is
exact and the currently captured native-ancestor envelope equals the stored envelope. A false health
probe makes the adapter re-register; capture-time self-heal remains limited to an exact event path.

- [ ] **Step 6: Bind MAIN activation to `{actionId,bindingNonce,state}`**

Implement in `src/content/page-main.js`:

```js
function paperActivationIdentity(button) {
  const actionId = String(button?.dataset?.tangoActionId || '');
  const bindingNonce = String(button?.dataset?.tangoBindingNonce || '');
  const state = String(button?.dataset?.tangoPaperState || '');
  if (!actionId || !bindingNonce
    || !['resolving-identity', 'ready', 'in-flight'].includes(state)) return null;
  return { actionId, bindingNonce, state, key: `${actionId}:${bindingNonce}:${state}` };
}

function publishPaperActivation(identity) {
  const type = identity.state === 'resolving-identity'
    ? 'PAPER_QUICK_BUY_INTENT' : 'PAPER_QUICK_BUY_CLICK';
  window.postMessage({
    source: 'TANGO_GMGN_PAGE', type,
    actionId: identity.actionId, bindingNonce: identity.bindingNonce
  }, '*');
}
```

Store `identity.key` on pointer/key down and require the same key on up. A semantic click additionally requires `event.target === button`, `detail === 0`, primary button, and `isTrusted !== false`.

- [ ] **Step 7: Re-run Task 1 tests**

Run the Step 4 command. Expected: all Task 1 tests pass, one paper activation is published, and every native sentinel remains at zero.

- [ ] **Step 8: Review the Task 1 diff without staging**

Run:

```powershell
git diff -- src/content/native-quick-buy-guard.js src/content/page-main.js tests/native-quick-buy-guard.test.js tests/page-main.test.js tests/gmgn-quick-buy-world-integration.test.js
git diff --check
```

Confirm no branch, index, or unrelated file changed.

---

### Task 2: Atomic adapter publication and addressless intent lifecycle

**Files:**
- Modify: `src/adapters/gmgn.js:1-22, 1153-1934`
- Modify: `src/content/quick-buy-safety.css:16-34`
- Modify: `tests/gmgn-adapter.test.js:84-289, 1373-1934, 3329-3600`
- Modify: `tests/content-runtime.test.js:2212-2353`
- Modify: `tests/native-quick-buy-guard.test.js:345-374`

**Interfaces:**
- Consumes: Task 1 Guard and MAIN message contracts.
- Produces:

```js
createQuickBuyGeneration({ slot, card, chain, address, href, amountNative })
  -> { generation: number, bindingNonce: string }

commitPaperQuickBuy(slot, nextBinding, action)
  -> boolean

recordQuickBuyIdentityIntent(binding, now = Date.now())
  -> { actionId, bindingNonce, expiresAt } | null

claimQuickBuyIdentityIntent(binding, evidence, now = Date.now())
  -> intent | null

cancelQuickBuyIdentityIntent(binding, reason)
  -> void

cardAddressEvidence(card, chain)
  -> { address, href, source: 'gmgn' | 'launchpad' } | null
```

Extend `quickBuyHarness` in this task with these concrete seams:

```js
Object.defineProperties(harness, {
  intentCount: { get: () => GMGN._quickBuyIntentCount() },
  visibleTrustedPaperCount: { get: () =>
    replacement?.isConnected && replacement.dataset.tangoPublished === '1' ? 1 : 0 }
});
harness.invokePaperAction = () => GMGN._invokeQuickBuyAction(
  replacement.dataset.tangoActionId,
  replacement.dataset.tangoBindingNonce,
  replacement.dataset.tangoPaperState === 'resolving-identity'
    ? 'PAPER_QUICK_BUY_INTENT' : 'PAPER_QUICK_BUY_CLICK'
);
harness.exposeCardHref = (nextHref) => {
  card.getAttribute = (name) => name === 'href' ? nextHref : null;
};
harness.flushPaperActions = () => new Promise((resolve) => setImmediate(resolve));
```

`guardHarness({ registerResult })` records the latest descriptor and implements the three Task 1
Guard methods. `withQuickBuyGlobals` follows the existing adapter-test global save/restore pattern,
installing the harness document, location, clock, and Guard for one callback. `addresslessIntentScenario`
is a thin composition of `quickBuyHarness`, those two helpers, an `orders` array, and explicit methods
that mutate exactly one of amount, route chain, connectedness, card href/generation, or clock.

- [ ] **Step 1: Add failing atomic-registration tests**

Extend the adapter harness with a configurable Guard and assert rollback:

```js
test('Guard registration failure cannot publish an active-looking successor', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness({ registerResult: false });
  withQuickBuyGlobals(harness, { guard }, () => {
    GMGN.discoverTokenCards(() => assert.fail('must not execute'), 1, '模拟盘');
    assert.equal(harness.visibleTrustedPaperCount, 0);
    assert.equal(harness.slot.dataset.tangoActionId, undefined);
    assert.equal(harness.replacement?.dataset?.tangoPublished, '0');
    assert.equal(harness.nativeControl.realHandlerCalls, 0);
  });
});

test('health reconciliation repairs a visible binding whose Guard trust was lost', () => {
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const guard = guardHarness({ registerResult: true });
  withQuickBuyGlobals(harness, { guard }, () => {
    GMGN.discoverTokenCards(() => {}, 1, '模拟盘');
    guard.trusted = false;
    assert.equal(GMGN.quickBuyNeedsReconcile(), true);
    GMGN.discoverTokenCards(() => {}, 1, '模拟盘');
    assert.equal(guard.trusted, true);
  });
});
```

- [ ] **Step 2: Replace disabled/pending tests with failing always-clickable state tests**

Update the old tests that require `disabled === true` or coherent symbol/name before activation:

```js
test('a staged addressless card exposes one protected resolving-identity action', () => {
  const harness = quickBuyHarness({ chain: 'base', address: '' });
  withQuickBuyGlobals(harness, () => {
    GMGN.discoverTokenCards(() => assert.fail('intent cannot trade'), 1, '模拟盘');
    assert.equal(harness.replacement.disabled, false);
    assert.equal(harness.replacement.dataset.tangoPaperState, 'resolving-identity');
    assert.ok(harness.replacement.dataset.tangoActionId);
    assert.ok(harness.replacement.dataset.tangoBindingNonce);
  });
});

test('valid address executes without waiting for symbol image or launchpad enrichment', async () => {
  const harness = quickBuyHarness({
    chain: 'base', address: EVM_ADDRESS, identityText: '', marketCap: ''
  });
  const orders = [];
  await withQuickBuyGlobals(harness, async () => {
    GMGN.discoverTokenCards((order) => orders.push(order), 1, '模拟盘');
    await harness.invokePaperAction();
  });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].token.address, EVM_ADDRESS);
  assert.equal(orders[0].token.symbol, 'TOKEN');
});
```

- [ ] **Step 3: Add failing 2,000 ms intent-generation tests**

Use a fake clock and mutation-driven rediscovery:

```js
test('one addressless intent resolves only on the same card generation approved href', async () => {
  const clock = { now: 1_000 };
  const harness = quickBuyHarness({ chain: 'base', address: '' });
  const orders = [];
  await withQuickBuyGlobals(harness, { clock }, async () => {
    GMGN.discoverTokenCards((order) => orders.push(order), 1, '模拟盘');
    const oldNonce = harness.replacement.dataset.tangoBindingNonce;
    await harness.invokePaperAction();
    await harness.invokePaperAction();
    assert.equal(harness.intentCount, 1);
    assert.equal(orders.length, 0);

    harness.exposeCardHref(`https://gmgn.ai/base/token/${EVM_ADDRESS}`);
    GMGN.discoverTokenCards((order) => orders.push(order), 1, '模拟盘', [harness.card]);
    await harness.flushPaperActions();
    assert.equal(orders.length, 1);
    assert.notEqual(harness.replacement.dataset.tangoBindingNonce, oldNonce);
  });
});

for (const cancellation of ['amount', 'chain', 'disconnect', 'card-reuse', 'expiry']) {
  test(`addressless intent cancels on ${cancellation}`, async () => {
    const scenario = addresslessIntentScenario(cancellation);
    await scenario.clickTwice();
    scenario.applyCancellation();
    scenario.exposeApprovedHref();
    await scenario.reconcile();
    assert.equal(scenario.orders.length, 0);
  });
}

test('a network quote alone cannot bind an addressless trench card', async () => {
  const scenario = addresslessIntentScenario('network-only');
  await scenario.clickTwice();
  scenario.publishNetworkQuote({ chain: 'base', address: EVM_ADDRESS, priceUsd: 1 });
  await scenario.reconcile();
  assert.equal(scenario.orders.length, 0);
});
```

Add feedback assertions in the same harness:

```js
assert.doesNotMatch(readyButton.title, /行情|market|K[- ]?line|waiting/i);
assert.match(resolvingButton.title, /token identity|代币身份/i);
assert.equal(resolvingButton.disabled, false);
assert.equal(inFlightButton.disabled, false);
assert.equal(inFlightButton.dataset.tangoPaperState, 'in-flight');
```

The expiry scenario advances from `1_000` to `3_001`; the `2_999` boundary must still allow the same-generation evidence.

- [ ] **Step 4: Run the adapter/runtime tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="registration failure|resolving-identity|addressless intent|valid address executes" tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/native-quick-buy-guard.test.js
```

Expected: current `pendingOnly`, deleted action ID, native `disabled`, ignored Guard result, and metadata gate fail the new assertions.

- [ ] **Step 5: Introduce generation, nonce, state, and typed action maps**

At the top of `src/adapters/gmgn.js`, add:

```js
const quickBuyActions = new Map();
const quickBuyIntents = new Map();
const quickBuyCardGenerations = new WeakMap();
let quickBuyGenerationSequence = 0;
let quickBuyNonceSequence = 0;

function cardGeneration(card) {
  if (!quickBuyCardGenerations.has(card)) {
    quickBuyCardGenerations.set(card, ++quickBuyGenerationSequence);
  }
  return quickBuyCardGenerations.get(card);
}

function nextBindingNonce(generation) {
  return `${generation}-${++quickBuyNonceSequence}`;
}
```

Store actions as:

```js
quickBuyActions.set(actionId, {
  bindingNonce,
  kind: state === 'resolving-identity' ? 'intent' : 'execute',
  invoke
});
```

The isolated message listener must require message type, `actionId`, `bindingNonce`, and matching action kind before invoking.

- [ ] **Step 6: Implement atomic `commitPaperQuickBuy` with rollback**

Use this publication order in one synchronous isolated-world turn:

```js
function commitPaperQuickBuy(slot, nextBinding, action) {
  const previous = publicationSnapshot(slot);
  stagePaperBinding(slot, nextBinding); // not visible; data-tango-published="0"
  const registered = registerPaperQuickBuy(slot, nextBinding);
  if (!registered || !Tango.NativeQuickBuyGuard.isPaperActionTrusted(
    nextBinding.replacement, nextBinding
  )) {
    restorePublicationSnapshot(slot, previous);
    nextBinding.replacement.dataset.tangoPublished = '0';
    nextBinding.replacement.remove?.();
    return false;
  }
  quickBuyActions.set(nextBinding.actionId, action);
  nextBinding.replacement.dataset.tangoPublished = '1';
  retirePreviousPaperBinding(previous, nextBinding);
  removeNativeQuickBuyControls(slot);
  return true;
}
```

Add a fail-closed unpublished rule at document start:

```css
html:not(.tango-paper-native-quick-buy-allowed) .tango-list-quick-buy[data-tango-published="0"] {
  pointer-events: none !important;
  visibility: hidden !important;
}
```

Do not reveal or add an action-map entry before both Guard calls return true. On failure restore every slot dataset/internal reference so the previous trusted paper binding remains exact.

- [ ] **Step 7: Implement intent recording, claiming, and cancellation**

Use a frozen record:

```js
const intent = Object.freeze({
  slot: binding.slot,
  card: binding.card,
  generation: binding.generation,
  actionId: binding.actionId,
  bindingNonce: binding.bindingNonce,
  chain: binding.chain,
  amountNative: binding.amountNative,
  createdAt: now,
  expiresAt: now + 2_000
});
```

`recordQuickBuyIdentityIntent` must only coalesce the same `actionId + bindingNonce` and must not reference `onQuickBuy`. `claimQuickBuyIdentityIntent` validates the old resolving binding and approved card-local href first, then transitions to a newly generated ready nonce/action ID; only after the ready binding is registered and published may it invoke the ready paper handler once.

Use state-specific title/ARIA copy: `resolving-identity` says token identity is being resolved,
`ready` states the paper amount, and `in-flight` says the paper order is processing. None may say
that price, market, or K-line data is waiting. Keep the existing immediate local active/pressed feedback.

- [ ] **Step 8: Replace native disabled transitions with paper state transitions**

In `createQuickBuyHandler`, `releaseQuickBuyOperation`, `createPendingQuickBuy`, `activatePendingQuickBuy`, `holdQuickBuyPending`, and React reinsertion:

```js
function setPaperState(slot, binding, state) {
  binding.state = state;
  binding.replacement.disabled = false;
  binding.replacement.dataset.tangoPaperState = state;
  slot.dataset.tangoPaperState = state;
  return registerPaperQuickBuy(slot, binding)
    && Tango.NativeQuickBuyGuard.isPaperActionTrusted(binding.replacement, binding);
}
```

Use the operation map to deduplicate `in-flight`; never use `disabled`, `aria-disabled="true"`, or deletion of the action ID as readiness control.

- [ ] **Step 9: Make address the only ready-state identity gate**

Change discovery so a valid same-chain address and positive amount create `ready`. Symbol, name, logo, launchpad, K-line, price, supply, and market cap enrich the order but cannot block it. Use address-derived placeholders:

```js
const token = {
  chain,
  address,
  symbol: clickMetadata?.symbol || 'TOKEN',
  name: clickMetadata?.name || clickMetadata?.symbol || 'Token',
  logoUrl: clickMetadata?.logoUrl || '',
  launchpad: clickMetadata?.launchpad || '',
  launchMode: clickMetadata?.launchMode || '',
  metadataVerified: Boolean(clickMetadata),
  metadataSource: clickMetadata ? 'GMGN_TRENCH' : ''
};
```

- [ ] **Step 10: Re-run Task 2 tests and the full adapter suite**

Run:

```powershell
node --test tests/native-quick-buy-guard.test.js tests/page-main.test.js tests/gmgn-quick-buy-world-integration.test.js tests/gmgn-adapter.test.js tests/content-runtime.test.js
```

Expected: all pass, including dynamic card reuse and zero native callbacks.

Also retain the existing bounded health-probe assertions: the 750 ms probe checks Guard trust for
every tracked paper shell, limits expensive identity/geometry work to 24 slots per pass, and lets
MutationObserver/presentation synchronization remain the primary path.

---

### Task 3: Owned visual wrapper and deterministic four-size profiles

**Files:**
- Modify: `src/adapters/gmgn.js:939-1361, 1530-1748`
- Modify: `src/content/content.css:19-97`
- Modify: `tests/gmgn-adapter.test.js:18-82, 1373-1934`
- Modify: `tests/content-structure.test.js:239-285`

**Interfaces:**
- Consumes: Task 2 binding state and presentation reconciliation.
- Produces:

```js
const QUICK_BUY_SIZE_PROFILES = Object.freeze({
  small: Object.freeze({ id: 'small', heightPx: 24, textPx: 12 }),
  large: Object.freeze({ id: 'large', heightPx: 28, textPx: 13 }),
  extraLarge: Object.freeze({ id: 'extra-large', heightPx: 32, textPx: 14 }),
  giant: Object.freeze({ id: 'giant', heightPx: 36, textPx: 16 })
});

readQuickBuyPresentation(control)
  -> { visual: { className, styleText, signature }, sizeSignal: { heightPx, textPx } }

resolveQuickBuySizeProfile(card, chain, presentation)
  -> { id, heightPx, textPx, revision }
```

The test-only helpers in this task are simple wrappers around the existing harness:

```js
const injectQuickBuy = (harness, label = '模拟盘') => withQuickBuyGlobals(harness, () =>
  GMGN.discoverTokenCards(() => {}, 0.1, label));
const fakeNative = ({ className = '', style = '' }) => ({
  className, style: { cssText: style }, getAttribute: (name) => name === 'style' ? style : null
});
const renderGeometry = ({ mount, slot }) => geometryHarness({ mount, slot }).measure();
```

`resolveSequence`, `resolveWithoutStableSignal`, `profileAfterColumnDisconnect`,
`profileAfterChainRouteChange`, and `geometryHarness` are local deterministic wrappers that call the
exported `_quickBuyProfileFromPresentation`, inject into one/two existing trench columns, trigger the
existing cleanup/discovery path, and return the named profile or measured boxes. They do not use a
browser or GMGN event.

- [ ] **Step 1: Add failing wrapper, profile, and sanitizer tests**

Add exact structural assertions:

```js
test('paper quick-buy owns one centered wrapper with exact child order', () => {
  const harness = quickBuyHarness();
  injectQuickBuy(harness);
  const wrapper = harness.replacement.children[0];
  assert.equal(wrapper.className, 'tango-quick-buy-content');
  assert.deepEqual(wrapper.children.map((child) => child.className), [
    'tango-paper-hint', 'tango-buy-amount'
  ]);
  assert.equal(wrapper.children[0].textContent, '模拟盘');
});

for (const [nativeClass, expected] of [
  [LIVE_QUICK_BUY_SMALL, ['small', 24, 12]],
  [LIVE_QUICK_BUY_LARGE, ['large', 28, 13]],
  [LIVE_QUICK_BUY_XL, ['extra-large', 32, 14]],
  [LIVE_QUICK_BUY_GIANT, ['giant', 36, 16]]
]) {
  test(`canonical profile ${expected[0]} owns its visual dimensions`, () => {
    const profile = GMGN._quickBuyProfileFromPresentation(nativeClass, '');
    assert.deepEqual([profile.id, profile.heightPx, profile.textPx], expected);
  });
}

test('transient geometry cannot enter the shared visual presentation', () => {
  const presentation = GMGN._readQuickBuyPresentation(fakeNative({
    className: 'h-[113px] px-[64px] text-[64px] leading-[100px] gap-12 flex-col items-start bg-blue-500 rounded-lg shadow-xl',
    style: 'height:113px;padding:64px;font-size:64px;line-height:100px;display:grid;color:white;background:#06f;border-radius:8px;box-shadow:0 2px 8px #000;'
  }));
  assert.doesNotMatch(presentation.visual.className, /h-|px-|text-\[64px\]|leading-|gap-|flex-col|items-start/);
  assert.doesNotMatch(presentation.visual.styleText, /height|padding|font-size|line-height|display/);
  assert.match(presentation.visual.styleText, /color|background|border-radius|box-shadow/);
});
```

- [ ] **Step 2: Add failing profile-cache and geometry tolerance tests**

Cover conflict retention, defaulting, propagation, invalidation, direct mount, and nested action host:

```js
assert.deepEqual(resolveSequence([
  LIVE_QUICK_BUY_LARGE,
  'h-[113px] text-[64px]',
  LIVE_QUICK_BUY_GIANT
]), ['large', 'large', 'giant']);

assert.equal(resolveWithoutStableSignal().id, 'large');
assert.ok(nextColumnRevision > previousColumnRevision);
assert.equal(profileAfterColumnDisconnect(), null);
assert.equal(profileAfterChainRouteChange().id, 'large');
assert.equal(profileFromCurrentChainCache().id, 'giant');
assert.equal(firstCardBackground(), secondCardBackground());

for (const mount of ['direct', 'nested-action-host']) {
  const geometry = renderGeometry({ mount, slot: { x: 10, y: 20, width: 84, height: 113 } });
  assert.ok(Math.abs(geometry.hit.width - geometry.slot.width) <= 1);
  assert.ok(Math.abs(geometry.hit.height - geometry.slot.height) <= 1);
  assert.ok(Math.abs(geometry.wrapperCenterX - geometry.slotCenterX) <= 0.5);
  assert.ok(Math.abs(geometry.wrapperCenterY - geometry.slotCenterY) <= 0.5);
}
```

- [ ] **Step 3: Run layout tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="owned|canonical profile|transient geometry|profile|wrapper|four sizes|dynamic" tests/gmgn-adapter.test.js tests/content-structure.test.js
```

Expected: current two-span root, forwarded height/padding/font/line-height/gap classes, `.68em` hint, and disabled CSS contract fail.

- [ ] **Step 4: Split presentation into stable visual tokens and raw size signals**

Allow only color/background/border/radius/outline/shadow/fill/stroke visual classes and style properties. Parse canonical raw height first, then raw text size:

```js
function profileFromSizeSignal({ heightPx, textPx }) {
  const byHeight = Object.values(QUICK_BUY_SIZE_PROFILES)
    .find((profile) => profile.heightPx === heightPx);
  const byText = Object.values(QUICK_BUY_SIZE_PROFILES)
    .find((profile) => profile.textPx === textPx);
  if (byHeight && byText && byHeight.id !== byText.id) return null;
  return byHeight || (!heightPx ? byText : null) || null;
}
```

Unknown/conflicting signals never overwrite a stable column profile.

- [ ] **Step 5: Implement column-first profile caching with monotonic revision**

Cache `{ profile, visual, revision }` by trench column and chain. Increment `quickBuyPresentationRevision` only for a coherent authoritative signature change. Delete a disconnected column entry during quick-buy cleanup and reset the active column/profile view when `chainFromUrl()` changes.

- [ ] **Step 6: Render the owned wrapper and CSS variables**

Change `renderQuickBuyContent` to append one wrapper and set the selected profile on the replacement:

```js
replacement.dataset.tangoQuickSize = profile.id;
replacement.style.setProperty('--tango-quick-buy-height', `${profile.heightPx}px`);
replacement.style.setProperty('--tango-quick-buy-text', `${profile.textPx}px`);
const wrapper = document.createElement('span');
wrapper.className = 'tango-quick-buy-content';
wrapper.append(hint, amount);
replacement.append(wrapper);
```

Add/update CSS:

```css
.tango-list-quick-buy {
  align-items: center !important;
  align-self: stretch !important;
  box-sizing: border-box;
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
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  font-size: var(--tango-quick-buy-text, 13px);
  gap: .22em;
  height: var(--tango-quick-buy-height, 28px);
  justify-content: center;
  line-height: 1;
  max-width: 100%;
}

.tango-paper-hint { font-size: .80em; line-height: 1; }
.tango-buy-amount { font-size: 1em; line-height: 1; }
```

Remove `.tango-list-quick-buy:disabled` styling; use `[data-tango-paper-state="in-flight"]` for neutral busy feedback without changing hit testing.

- [ ] **Step 7: Re-run Task 3 tests and dynamic insertion regressions**

Run:

```powershell
node --test tests/gmgn-adapter.test.js tests/content-structure.test.js tests/content-runtime.test.js
```

Expected: all four sizes, new meme insertion, GMGN size switching, onboarding-first render, and same-column background tests pass.

---

### Task 4: Independent quote dimensions and deterministic no-market fallback

**Files:**
- Modify tests first: `tests/gmgn-quotes.test.js`
- Modify tests first: `tests/content-runtime.test.js:2460-3109, 3700-4133`
- Modify only if RED demonstrates a defect: `src/adapters/gmgn-quotes.js:104-423`
- Modify only if RED demonstrates a defect: `src/content/content.js:850-1165`

**Interfaces:**
- Consumes: `Tango.GMGNQuotes.mergeObservation`, `Tango.Supply.resolve`, `Tango.Supply.fallbackValuation`.
- Produces the existing `resolvePaperTradeQuote(token, candidate, { position })` shape with independent `priceUsd`, `totalSupply`, and `nativePriceUsd` provenance.

- [ ] **Step 1: Add a quote-dimension characterization matrix**

Add tests that must remain green unless a hidden coupling exists:

```js
test('a newer trustworthy token price survives without exact supply', () => {
  const merged = Quotes.mergeObservation(
    { chain: 'base', address: EVM_ADDRESS, totalSupply: 100_000_000_000,
      supplySource: 'GMGN_EXACT', totalSupplyObservedAt: 1_000, source: 'GMGN_NETWORK' },
    { chain: 'base', address: EVM_ADDRESS, priceUsd: 0.00000008,
      priceObservedAt: 2_000, observedAt: 2_000, source: 'GMGN_NETWORK' }
  );
  assert.equal(merged.priceUsd, 0.00000008);
  assert.equal(merged.totalSupply, 100_000_000_000);
});

test('supply-only payload cannot fabricate or replace token price', () => {
  const merged = Quotes.mergeObservation(undefined, {
    chain: 'base', address: EVM_ADDRESS, totalSupply: 100_000_000_000,
    supplySource: 'GMGN_EXACT', observedAt: 2_000, source: 'GMGN_NETWORK'
  });
  assert.equal(Number(merged.priceUsd || 0), 0);
});
```

- [ ] **Step 2: Add all-chain no-market execution quote tests**

For `sol`, `eth`, `bsc`, `base`, `robinhood`, and `xlayer`, assert no price/native data returns immediately:

```js
assert.equal(quote.marketCapUsd, 3_200);
assert.equal(quote.totalSupply, expectedSupply);
assert.equal(quote.priceUsd, 3_200 / expectedSupply);
assert.equal(quote.nativePriceUsd, 1);
assert.equal(quote.syntheticTokenPrice, true);
assert.equal(quote.syntheticNativePrice, true);
assert.equal(quote.paperFallback, true);
```

Use the full launchpad table plus unknown. Add a second assertion where a factual price is present but supply is absent; `quote.priceUsd` must equal the factual price rather than `$3,200 / expectedSupply`.

- [ ] **Step 3: Add contaminated/stale partial-payload fallback tests**

Feed identityless, wrong-address, cross-chain, stale, non-finite, and conflicting payloads. Assert the invalid dimensions are discarded and a valid paper identity still gets the deterministic fallback; no case returns `nativePriceUnavailable`, `staleQuote`, `invalidQuote`, or `invalidArithmetic` from the local paper resolver.

- [ ] **Step 4: Run the quote matrix**

Run:

```powershell
node --test tests/gmgn-quotes.test.js
node --test --test-name-pattern="trustworthy token price|all-chain no-market|contaminated|deterministic" tests/content-runtime.test.js
```

Expected: existing independent-dimension code should mostly pass. Any RED must identify a specific merge/resolver coupling before production edits.

- [ ] **Step 5: Apply only the minimal dimension fix if a new test is RED**

Keep this selector order in `resolvePaperTradeQuote`:

```js
const executionSupply = supply?.totalSupply || fallback.totalSupply;
const derivedPrice = !safeObservedPrice && safeMarketCapUsd > 0
  ? safeMarketCapUsd / executionSupply : 0;
const fallbackPrice = fallback.marketCapUsd / executionSupply;
const priceUsd = safeObservedPrice || derivedPrice || historicalPrice || fallbackPrice;
const nativePriceUsd = Number(lastKnownNativeObservation(chain.id, local, position).price || 1);
```

Never make `safeObservedPrice` conditional on exact supply.

- [ ] **Step 6: Re-run Task 4 and existing resolver tests**

Run:

```powershell
node --test tests/gmgn-quotes.test.js tests/supply.test.js tests/content-runtime.test.js
```

---

### Task 5: Pre-execution supply upgrades and dimension-neutral calibration

**Files:**
- Modify: `src/core/engine.js:91-98, 521-842`
- Modify: `tests/engine.test.js:92-402, 1044-1150`
- Modify: `tests/state.test.js:269-587`

**Interfaces:**
- Consumes: verified token metadata, existing position, and Task 4 executable quote.
- Produces:

```js
preparePositionForExecution(state, token, quote, now, staleMs)
  -> {
    state,
    key,
    position,
    trustContext,
    calibrationStatus: 'NOOP' | 'CALIBRATED'
  }
```

Add these test fixture helpers beside the existing `internalUnknownFallbackQuote` helper:

```js
function buyUnknownFallback({ chain, amountNative = 1 }) {
  const address = chain === 'sol' ? token.address : EVM_ADDRESS;
  const initial = State.createInitialState({ now: 1, initialBalances: { [chain]: 10 } });
  initial.initialized = true;
  const testSettings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0,
    chains: { [chain]: { networkFeeNative: 0 } }
  });
  const fallback = Tango.Supply.fallbackValuation({ chain, launchpad: 'Unknown' });
  const provisionalToken = { chain, address, symbol: 'UPGRADE' };
  const fallbackQuote = {
    chain, address, ...fallback,
    marketCapDivisor: fallback.totalSupply,
    provisionalSupply: fallback.totalSupply,
    nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_FALLBACK', valuationMode: 'MARKET_CAP',
    priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP', syntheticTokenPrice: true,
    provisional: true, paperFallback: true
  };
  const bought = Engine.executeBuy(initial, {
    token: provisionalToken, quote: fallbackQuote, amountNative
  }, testSettings, 1_000);
  return {
    state: bought.state, position: bought.position,
    key: Engine.positionKey(chain, address), address, settings: testSettings
  };
}

function buyFallbackPosition(scenario) {
  let base = buyUnknownFallback({ chain: scenario.chain });
  if (scenario.name === 'Mayhem') {
    const initial = State.createInitialState({ now: 1, initialBalances: { sol: 10 } });
    initial.initialized = true;
    const pumpSettings = State.normalizeSettings({
      slippageBps: 0, platformFeeBps: 0,
      chains: { sol: { networkFeeNative: 0 } }
    });
    const standardToken = {
      chain: 'sol', address: token.address, symbol: 'PUMP', launchpad: 'Pump.fun',
      launchMode: '', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    };
    const standard = Tango.Supply.fallbackValuation({
      chain: 'sol', launchpad: 'Pump.fun', launchMode: ''
    });
    const standardQuote = {
      chain: 'sol', address: token.address, ...standard,
      marketCapDivisor: standard.totalSupply,
      nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_DETAIL', valuationMode: 'MARKET_CAP',
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP', syntheticTokenPrice: true,
      provisional: true, paperFallback: true
    };
    const bought = Engine.executeBuy(initial, {
      token: standardToken, quote: standardQuote, amountNative: 1
    }, pumpSettings, 1_000);
    base = {
      state: bought.state, position: bought.position, address: token.address,
      key: Engine.positionKey('sol', token.address), settings: pumpSettings
    };
  }
  const launchpad = scenario.name === 'Mayhem' ? 'Pump.fun' : scenario.name;
  const launchMode = scenario.name === 'Mayhem' ? 'Mayhem' : '';
  const verifiedToken = {
    chain: scenario.chain, address: base.address, symbol: scenario.name,
    launchpad, launchMode, metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  const upgradeQuote = {
    chain: scenario.chain, address: base.address,
    priceUsd: 3_200 / scenario.to, marketCapUsd: 3_200,
    totalSupply: scenario.to, marketCapDivisor: scenario.to,
    supplySource: 'LAUNCHPAD_RULE', nativePriceUsd: 2_000,
    observedAt: 2_000, priceObservedAt: 2_000,
    marketCapObservedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_DETAIL', valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED', syntheticTokenPrice: false,
    provisional: false, paperFallback: true
  };
  return { ...base, verifiedToken, upgradeQuote };
}
```

- [ ] **Step 1: Add RED tests for upgrade-before-repeat-buy and upgrade-before-sell**

Add a table for Bankr, Clanker, and Mayhem:

```js
for (const scenario of [
  { name: 'Bankr', chain: 'robinhood', from: 1_000_000_000, to: 100_000_000_000 },
  { name: 'Clanker', chain: 'base', from: 1_000_000_000, to: 100_000_000_000 },
  { name: 'Mayhem', chain: 'sol', from: 1_000_000_000, to: 2_000_000_000 }
]) {
  test(`verified ${scenario.name} context upgrades before repeat buy`, () => {
    const fixture = buyFallbackPosition(scenario);
    const rebought = Engine.executeBuy(fixture.state, {
      token: fixture.verifiedToken,
      quote: fixture.upgradeQuote,
      amountNative: 1
    }, fixture.settings, 2_000);
    assert.equal(rebought.state.calibrations[0].fromSupply, scenario.from);
    assert.equal(rebought.state.calibrations[0].toSupply, scenario.to);
    assert.ok(Math.abs(rebought.state.calibrations[0].quantityAfter
      - fixture.position.quantity * scenario.to / scenario.from) <= 1e-12);
    assert.ok(Number.isFinite(rebought.position.quantity));
  });

  test(`verified ${scenario.name} context upgrades before exact 100 percent sell`, () => {
    const fixture = buyFallbackPosition(scenario);
    const sold = Engine.executeSell(fixture.state, {
      token: fixture.verifiedToken, quote: fixture.upgradeQuote, percent: 100
    }, fixture.settings, 2_000);
    assert.ok(Math.abs(sold.trade.quantity
      - sold.state.calibrations[0].quantityAfter) <= 1e-12);
    assert.equal(sold.state.positions[fixture.key], undefined);
    assert.ok(Math.abs(sold.state.accounts[scenario.chain].cashBalanceNative - 10) <= 1e-12);
  });
}
```

Expected current failure: `invalidQuote` occurs before calibration in `executeBuy`/`executeSell`.

- [ ] **Step 2: Add a RED test proving a simultaneous real price move is not neutralized**

```js
test('supply representation changes neutrally while a simultaneous factual price move remains PnL', () => {
  const fixture = buyUnknownFallback({ chain: 'robinhood', amountNative: 1 });
  const old = fixture.position;
  const moved = Engine.updatePositionQuote(fixture.state, fixture.bankrToken, {
    ...fixture.bankr100BQuote,
    priceUsd: old.lastPriceUsd / 100 * 2,
    marketCapUsd: old.lastMarketCapUsd * 2
  }, 2_000);
  const next = moved.positions[fixture.key];
  assert.equal(next.quantity, old.quantity * 100);
  assert.ok(Math.abs(Engine.markPosition(next).valueNative
    - Engine.markPosition(old).valueNative * 2) <= 1e-12);
});
```

Expected current failure: quantity becomes `50x` because the current preservation formula neutralizes the genuine `2x` price move.

- [ ] **Step 3: Add partial-sell, immutability, and arithmetic assertions**

For each 1B/2B/100B scenario:

```js
assert.deepEqual(calibrated.trades.slice(1), historicalTrades);
assert.equal(calibrated.calibrations[0].reason, 'SUPPLY');
assert.equal(calibrated.position.costBasisNative, before.costBasisNative);
assert.ok(Object.values(calibrated.state.accounts).every((account) =>
  Number.isFinite(account.cashBalanceNative) && account.cashBalanceNative >= 0));
assert.doesNotThrow(() => State.normalizeState(calibrated.state, settings, { strict: true }));
```

Also sell 25%, then 100% of the remainder. The first sell must consume exactly `calibratedQuantity * .25`; the final sell must consume the stored remaining quantity.

- [ ] **Step 4: Run the focused Engine RED tests**

Run:

```powershell
node --test --test-name-pattern="verified (Bankr|Clanker|Mayhem) context|simultaneous factual price move" tests/engine.test.js
```

Do not change production code unless failures are the expected `invalidQuote` or quantity/value mismatch.

- [ ] **Step 5: Implement `preparePositionForExecution` and use it in buy and sell**

Use this exact order:

```js
function preparePositionForExecution(state, token, quote, now, staleMs) {
  const chain = Tango.Chains.require(token?.chain).id;
  const key = positionKey(chain, token?.address);
  const existing = state.positions?.[key] || null;
  const caller = callerTokenSupplyContext(token, chain,
    Tango.Chains.normalizeAddress(chain, token.address));
  const baseContext = existing || caller;
  const mergedContext = verifiedLaunchContext(baseContext, token);
  const first = validateQuote(quote, now, staleMs, baseContext, mergedContext);
  if (!first.ok) throw new Error(first.reason);

  const calibration = existing
    ? calibratePositionResult(state, token, quote, now)
    : { status: 'NOOP', state };
  if (calibration.status === 'FAILED') throw new Error(calibration.reason);
  const position = calibration.state.positions?.[key] || null;
  const trustContext = verifiedLaunchContext(position || caller, token);
  const second = validateQuote(quote, now, staleMs, position || caller, trustContext);
  if (!second.ok) throw new Error(second.reason);
  return {
    state: calibration.state, key, position, trustContext,
    calibrationStatus: calibration.status
  };
}
```

Both `executeBuy` and `executeSell` must start arithmetic from the returned state/position and must not run their old pre-merge validation.

- [ ] **Step 6: Correct neutral calibration to use only representation ratios**

Replace the current `preservedValueNative / newPriceUsd` quantity formula with:

```js
const supplyRatio = supplyCorrection
  ? observedSupply.totalSupply / oldSupply.totalSupply : 1;
const oldNativePriceUsd = Number(existing.lastNativePriceUsd || newNativePriceUsd);
const nativeRatio = nativeCorrection ? newNativePriceUsd / oldNativePriceUsd : 1;
const nextQuantity = Number(existing.quantity) * supplyRatio * nativeRatio;
const nextAverageEntryPriceUsd = Number(existing.costBasisNative)
  * newNativePriceUsd / nextQuantity;
```

Set `lastPriceUsd = newPriceUsd`. This preserves value for a pure supply/native representation correction but lets a genuine new token price change the marked PnL.

- [ ] **Step 7: Re-run Engine and strict-state tests**

Run:

```powershell
node --test tests/engine.test.js tests/state.test.js tests/supply.test.js
```

Expected: repeat buy, partial sell, exact 100% sell, neutral round trip, simultaneous price move, strict reload, and immutable historical trade tests all pass.

---

### Task 6: Full product regression locks for first render, markers, chain isolation, and switches

**Files:**
- Modify tests only as needed: `tests/content-runtime.test.js`
- Modify tests only as needed: `tests/markers.test.js`
- Modify tests only as needed: `tests/dashboard-runtime.test.js`
- Modify tests only as needed: `tests/popup-runtime.test.js`
- Modify tests only as needed: `tests/background.test.js`
- Modify production only for a demonstrated RED in: `src/content/content.js`, `src/content/chart-main.js`, `src/content/markers.js`, `src/dashboard/dashboard.js`, `src/popup/popup.js`, `src/background.js`

**Interfaces:**
- Consumes: Tasks 1-5 behavior.
- Produces no new public API; this task locks prior behavior against regression.

- [ ] **Step 1: Update the first-render runtime contract to always-clickable states**

Change the existing staged-first-card test so onboarding/storage initialization immediately leaves one protected paper shell:

```js
assert.equal(replacement.disabled, false);
assert.ok(['resolving-identity', 'ready'].includes(replacement.dataset.tangoPaperState));
assert.ok(replacement.dataset.tangoActionId);
assert.equal(nativeCallbacks, 0);
```

After a newly inserted meme exposes its href, mutation reconciliation must leave exactly one ready paper control without navigation or native callback.

- [ ] **Step 2: Lock detail panel and marker replay before K-line readiness**

Assert:

```js
assert.ok(renderedDetailPanel, 'valid detail route renders before chart/token data');
assert.deepEqual(loaded.api.runtime.latestMarkerPayload.markers.map((item) => item.side), ['BUY']);
loaded.api.dispatchWindowMessage({
  source: frame.contentWindow,
  data: { source: 'TANGO_PAPER_CHART', type: 'READY', chain, address, probeId }
});
const replay = frame.messages.filter((message) => message.type === 'CHART_MARKERS').at(-1);
assert.deepEqual(replay.payload.markers.map((item) => item.side), ['BUY']);
```

Then execute a detail sell and require `['BUY', 'SELL']`. Disable all features and require an empty marker payload and zero overlay children. Re-enable and require reconstruction from current-chain state only.

Publish a factual same-token GMGN/K-line price after a fallback quick buy and assert the visible marker
moves to the factual price/supply coordinate while the stored BUY trade stays byte-for-byte equal.
For a 100B Bankr entry, the price-axis marker must use `entryMarketCapUsd / 100_000_000_000`, not a
1B divisor and not the old provisional y-coordinate.

- [ ] **Step 3: Lock chart READY probe correlation and no feedback loop**

Keep the existing `CHART_READY_PROBE`/`probeId` assertions and add a quick-buy-before-frame-ready case. Twenty `CHART_MARKERS` deliveries must not emit another READY. A stale A-route frame cannot receive B-route markers.

- [ ] **Step 4: Lock onboarding principal, referral entry, and first GMGN render**

In `tests/dashboard-runtime.test.js`, complete onboarding with `10` and assert every chain receives ten units of its own native asset, the note names all six allocations, and the only opened external URL is:

```js
'https://gmgn.ai/r/X9cuc5jd?chain=bsc'
```

The GMGN page startup runtime test must immediately create protected quick-buy controls without requiring a detail-page round trip.

- [ ] **Step 5: Lock tab-local chain and shortcut synchronization**

Run/extend Popup, Dashboard, content, and background tests so:

```js
assert.equal(popupChain, routeChain);
assert.equal(headerBalanceChain, routeChain);
assert.ok(positions.every((position) => position.chain === routeChain));
assert.equal(selectedChainWriteCountFromRouteChanges, 0);
assert.equal(masterSwitch.checked, settings.enabled);
```

Two rapid `Alt+Shift+P` commands serialize, the open Popup switch follows the storage update, and neither Popup nor Dashboard oscillates between BSC and Robinhood.

The PnL calendar deep link must include the active route chain and Dashboard must render only that
chain's trade/PnL records. An OFF-to-ON storage update must activate the current GMGN page without a
refresh; OFF must remove the detail panel, paper overlays, and chart lines before native UI is restored.

- [ ] **Step 6: Run all Task 6 regressions**

Run:

```powershell
node --test tests/content-runtime.test.js tests/markers.test.js tests/dashboard-runtime.test.js tests/popup-runtime.test.js tests/background.test.js
```

Modify production only when a named regression is RED; retain the existing route-epoch and probe-ID checks.

---

### Task 7: Security review, full verification, build, and source/package identity

**Files:**
- Verify: all modified `src/`, `tests/`, `manifest.json`, and `scripts/validate-extension.js`
- Generate only after source gates pass: `dist/tango-paper-trader/**`

**Interfaces:**
- Consumes: verified source tree.
- Produces: an unpacked Chrome extension at `D:\web3\code_project\tango-paper-trade\dist\tango-paper-trader` whose package files exactly match source.

- [ ] **Step 1: Review the complete diff and forbidden capabilities**

Run:

```powershell
git diff --check
rg -n "ethereum|personal_sign|eth_sign|eth_sendTransaction|sendTransaction|signTransaction|connectWallet|approve|swap/route|broadcastTransaction|new WebSocket" src manifest.json
```

Every match must be an existing validator/test string or otherwise proven unrelated to executable real-funds capability. Do not open or operate GMGN trading UI.

- [ ] **Step 2: Run the complete source suite and validator**

Run:

```powershell
npm.cmd test
npm.cmd run check
```

Expected: zero failures and validator success.

- [ ] **Step 3: Build the unpacked extension**

Only after Step 2 passes, run:

```powershell
npm.cmd run build
```

This intentionally regenerates only `dist/tango-paper-trader` from `manifest.json`, `popup.html`, `dashboard.html`, `README.md`, `PRIVACY.md`, `src`, and `docs/multichain-smoke-test.md`.

- [ ] **Step 4: Re-run tests and validation after the build**

Run:

```powershell
npm.cmd test
npm.cmd run check
```

- [ ] **Step 5: Compare source and package file sets plus SHA-256 hashes**

Run this PowerShell comparison from the worktree root:

```powershell
$packageRoot = (Resolve-Path 'dist/tango-paper-trader').Path
$sourceRoots = @('manifest.json','popup.html','dashboard.html','README.md','PRIVACY.md','src','docs/multichain-smoke-test.md')
$expected = foreach ($entry in $sourceRoots) {
  $resolved = Resolve-Path $entry
  if ((Get-Item $resolved).PSIsContainer) {
    Get-ChildItem -LiteralPath $resolved -Recurse -File | ForEach-Object {
      [pscustomobject]@{ Relative = [IO.Path]::GetRelativePath((Resolve-Path '.').Path, $_.FullName); Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash }
    }
  } else {
    [pscustomobject]@{ Relative = $entry; Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash }
  }
}
$actual = Get-ChildItem -LiteralPath $packageRoot -Recurse -File | ForEach-Object {
  [pscustomobject]@{ Relative = [IO.Path]::GetRelativePath($packageRoot, $_.FullName); Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash }
}
$comparison = Compare-Object ($expected | Sort-Object Relative) ($actual | Sort-Object Relative) -Property Relative,Hash
if ($comparison) { $comparison | Format-Table -AutoSize; throw 'Source/package mismatch' }
```

Expected: no comparison rows and no exception.

- [ ] **Step 6: Confirm final loading directory and working-tree preservation**

Run:

```powershell
Resolve-Path 'dist/tango-paper-trader'
git status --short
```

Report the verified loading directory and the exact test counts. Do not stage or commit the user's existing changes.

---

## Self-Review Checklist

- [x] Every approved spec requirement maps to a task: Guard, MAIN bridge, intent generation, atomic publication, layout profiles, quote dimensions, supply upgrades, feedback, markers, onboarding, chain isolation, calendar deep link, shortcut, and release gates.
- [x] Every production change has a named focused RED test or is explicitly a regression-only conditional edit.
- [x] `bindingNonce`, `generation`, `state`, action message fields, and Engine preparation signatures are identical across tasks.
- [x] No task permits native GMGN activation or any wallet/transaction capability.
- [x] No task stages, commits, resets, cleans, switches branches, or overwrites unrelated work.
