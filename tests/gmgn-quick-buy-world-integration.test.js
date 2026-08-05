const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const EVM_ADDRESS_2 = '0x2222222222222222222222222222222222222222';
const source = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

function loadIntegratedQuickBuyWorld({ now = 1_000 } = {}) {
  const registrations = [];
  const paperOrders = [];
  const clock = { now };
  let paperCallbacks = 0;
  const paperAssets = {
    cash: 4_242,
    positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
    trades: [{ id: 'sentinel-trade', side: 'BUY' }],
    markers: [{ id: 'sentinel-marker', price: 11 }]
  };
  const commitPaperCallback = (order = {}) => {
    paperCallbacks += 1;
    paperAssets.cash -= Number(order.amountNative || 1);
    paperAssets.positions.push({
      chain: order.token?.chain || 'base', address: order.token?.address || EVM_ADDRESS, quantity: 1
    });
    paperAssets.trades.push({ id: order.actionId || 'ready-action', side: 'BUY' });
    paperAssets.markers.push({ id: order.actionId || 'ready-action', price: order.quote?.priceUsd || 0 });
  };
  let nativeCaptureCalls = 0;
  let nativeBubbleCalls = 0;

  class FakeElement {
    constructor(selectors = []) {
      this.selectors = new Set(selectors);
      this.dataset = {};
      this.attributes = new Map();
      this.classNames = new Set();
      this.className = '';
      this.style = { cssText: '' };
      this.tagName = 'DIV';
      this.disabled = false;
      this.innerText = '';
      this.textContent = '';
      this.isConnected = true;
      this.children = new Set();
      this.parentElement = null;
      this.parentNode = null;
      this.listeners = new Map();
      this.classList = {
        add: (...names) => names.forEach((name) => this.classNames.add(name)),
        remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
        contains: (name) => this.classNames.has(name),
        toggle: (name, enabled) => enabled ? this.classNames.add(name) : this.classNames.delete(name)
      };
    }
    matches(selector) {
      if (this.selectors.has(selector)) return true;
      if (selector === '[data-testid="quickbuy"]') return this.getAttribute('data-testid') === 'quickbuy';
      if (selector === '[data-tango-paper-action="quick-buy"]') {
        return this.dataset.tangoPaperAction === 'quick-buy';
      }
      return false;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (node.matches(selector)) return node;
      }
      return null;
    }
    contains(element) {
      return element === this || [...this.children].some((child) => child.contains(element));
    }
    appendChild(element) {
      if (element.parentElement && element.parentElement !== this) {
        element.parentElement.children.delete(element);
      }
      element.parentElement = this;
      element.parentNode = this;
      element.isConnected = true;
      this.children.add(element);
      return element;
    }
    append(...elements) { elements.forEach((element) => this.appendChild(element)); }
    removeChild(element) {
      if (!this.children.delete(element)) throw new Error('Element is not a child');
      if (element.parentElement === this) element.parentElement = null;
      if (element.parentNode === this) element.parentNode = null;
      return element;
    }
    replaceWith(element) {
      const parent = this.parentElement;
      if (parent) {
        parent.removeChild(this);
        parent.appendChild(element);
      }
      this.isConnected = false;
    }
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
      this.isConnected = false;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttributeNames() { return [...this.attributes.keys()]; }
    getBoundingClientRect() { return { width: 80, height: 24 }; }
    querySelectorAll(selector) {
      const matches = [];
      for (const child of this.children) {
        if (child.matches(selector)) matches.push(child);
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, listener, options = false) {
      const entries = this.listeners.get(type) || [];
      entries.push({ type, listener, options });
      this.listeners.set(type, entries);
    }
  }

  const register = (world) => (type, listener, options) => {
    registrations.push({ world, type, listener, options });
  };
  let guardContext;
  let relayIsolatedMessage = () => {
    throw new Error('isolated message relay was not installed');
  };
  const pageContext = {
    console,
    Element: FakeElement,
    URL,
    Date: class extends Date { static now() { return clock.now; } },
    location: { href: `https://gmgn.ai/base/token/${EVM_ADDRESS}` },
    XMLHttpRequest: class { open() {} send() {} addEventListener() {} },
    fetch: async () => ({ ok: false, headers: { get: () => '' } }),
    document: { documentElement: { classList: { contains: () => false } } },
    addEventListener: register('main'),
    postMessage(message) {
      if (message?.source === 'TANGO_GMGN_PAGE'
        && ['PAPER_QUICK_BUY_INTENT', 'PAPER_QUICK_BUY_CLICK'].includes(message.type)) {
        paperOrders.push(message);
        relayIsolatedMessage(message);
      }
    },
    Tango: { GMGNQuotes: { extract: () => [], extractNativePrices: () => [], mergeObservation: (_, next) => next } }
  };
  pageContext.window = pageContext;
  pageContext.top = pageContext;

  guardContext = {
    console,
    Element: FakeElement,
    Date: class extends Date { static now() { return clock.now; } },
    URL,
    location: { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' },
    requestAnimationFrame: (callback) => callback(),
    getComputedStyle: () => ({ width: '80px', height: '24px', padding: '0px' }),
    document: {
      documentElement: { classList: { contains: () => false } },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => new FakeElement()
    },
    addEventListener: register('guard'),
    Tango: {}
  };
  guardContext.window = guardContext;

  // Manifest order: isolated-world constants/guard first, then MAIN-world dependencies/page tap.
  vm.runInNewContext(source('src/shared/constants.js'), guardContext, { filename: 'src/shared/constants.js' });
  vm.runInNewContext(source('src/content/native-quick-buy-guard.js'), guardContext, {
    filename: 'src/content/native-quick-buy-guard.js'
  });
  vm.runInNewContext(source('src/core/chains.js'), guardContext, { filename: 'src/core/chains.js' });
  vm.runInNewContext(source('src/core/supply.js'), guardContext, { filename: 'src/core/supply.js' });
  vm.runInNewContext(source('src/adapters/gmgn.js'), guardContext, {
    filename: 'src/adapters/gmgn.js'
  });
  guardContext.__adapterMessageListener = registrations.find((entry) =>
    entry.world === 'guard' && entry.type === 'message'
  )?.listener;
  assert.equal(typeof guardContext.__adapterMessageListener, 'function');
  relayIsolatedMessage = (message) => {
    guardContext.__mainWorldMessage = message;
    return vm.runInNewContext(
      '__adapterMessageListener({ source: window, data: __mainWorldMessage })',
      guardContext,
      { filename: 'tests/isolated-message-relay.js' }
    );
  };
  vm.runInNewContext(source('src/core/chains.js'), pageContext, { filename: 'src/core/chains.js' });
  vm.runInNewContext(source('src/core/supply.js'), pageContext, { filename: 'src/core/supply.js' });
  vm.runInNewContext(source('src/adapters/gmgn-quotes.js'), pageContext, { filename: 'src/adapters/gmgn-quotes.js' });
  vm.runInNewContext(source('src/content/page-main.js'), pageContext, { filename: 'src/content/page-main.js' });

  function mountReadyPaper({ chain, address, amountNative = 1 }) {
    const paper = new FakeElement(['[data-tango-paper-action="quick-buy"]']);
    const slot = new FakeElement(['.BuyButton-continer']);
    const card = new FakeElement(['[class~="group/a"]']);
    const root = new FakeElement(['[data-sentry-component="BuyButtons"]']);
    const actionId = `paper:${chain}:${address}`;
    const bindingNonce = 'nonce-1';
    const generation = 1;
    const state = 'ready';
    const binding = {
      replacement: paper, slot, card, actionId, bindingNonce, generation, state,
      chain, address, href: `https://gmgn.ai/${chain}/token/${address}`,
      amountNative, pendingOnly: false
    };
    Object.assign(paper.dataset, {
      tangoPaperAction: 'quick-buy', tangoActionId: actionId,
      tangoBindingNonce: bindingNonce, tangoCardGeneration: String(generation), tangoPaperState: state
    });
    Object.assign(slot.dataset, {
      tangoQuickBuy: '1', tangoActionId: actionId,
      tangoBindingNonce: bindingNonce, tangoCardGeneration: String(generation), tangoPaperState: state
    });
    slot.__tangoQuickBuyBinding = binding;
    slot.__tangoReplacementQuickBuy = paper;
    slot.__tangoQuickBuyCard = card;
    slot.appendChild(paper);
    card.appendChild(slot);
    root.appendChild(card);
    const mounted = {
      paper, slot, card, root, binding, actionId, bindingNonce, generation, state,
      chain, address, href: binding.href, amountNative
    };
    addNativeSentinels(slot);
    addNativeSentinels(root);
    assert.equal(guardContext.Tango.GMGN._commitPaperQuickBuy(slot, binding, {
      bindingNonce, kind: 'execute', invoke: commitPaperCallback
    }), true);
    return mounted;
  }

  function mountResolvingPaper({ chain = 'base', amountNative = 1, policyKey = 'policy:enabled' } = {}) {
    const outerRoot = new FakeElement(['[data-sentry-component="BuyButtons"]']);
    const birthRoot = new FakeElement([
      '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]'
    ]);
    const card = new FakeElement(['[class~="group/a"]']);
    const slot = new FakeElement(['.BuyButton-continer']);
    const paper = new FakeElement(['[data-tango-paper-action="quick-buy"]']);
    const column = new FakeElement(['[data-sentry-component="TrenchColumn"]']);
    paper.tagName = 'BUTTON';
    card.innerText = 'TEST Test Token\nMC\n$10K';
    card.textContent = card.innerText;
    column.appendChild(outerRoot);
    outerRoot.appendChild(birthRoot);
    birthRoot.appendChild(card);
    card.appendChild(slot);
    slot.appendChild(paper);
    const { generation, bindingNonce } = guardContext.Tango.GMGN._createQuickBuyGeneration({ card });
    const actionId = `paper:${bindingNonce}`;
    const birth = {
      card, slot, root: birthRoot, generation, chain, bornAt: clock.now,
      firstAddressHref: '', eligible: true
    };
    const onQuickBuy = commitPaperCallback;
    const chainDefinition = guardContext.Tango.Chains.get(chain);
    const binding = {
      slot, key: '', chain, address: '', href: '', card, nativeControl: null,
      replacement: paper, actionId, bindingNonce, generation, state: 'resolving-identity',
      amountNative, paperLabel: 'PAPER', policyKey, birth, birthAmountNative: amountNative,
      onQuickBuy, chainDefinition, pendingOnly: false, additionalNativeControls: [],
      repairAttempts: 0, repairTimer: null, resizeObserver: null, resizeTargets: []
    };
    const context = { onQuickBuy, chainDefinition, paperLabel: 'PAPER', policyKey };
    const action = {
      bindingNonce,
      kind: 'intent',
      invoke: () => guardContext.Tango.GMGN._acceptQuickBuyIdentityActivation(binding, context)
    };
    assert.equal(guardContext.Tango.GMGN._commitPaperQuickBuy(slot, binding, action), true);
    addNativeSentinels(slot);
    addNativeSentinels(outerRoot);
    return {
      paper, slot, card, root: outerRoot, birthRoot, binding, context,
      actionId, bindingNonce,
      exposeHref(address = EVM_ADDRESS) {
        card.setAttribute('href', `https://gmgn.ai/${chain}/token/${address}`);
      },
      removeHref() { card.removeAttribute('href'); },
      addConflictingHref(address = '0x2222222222222222222222222222222222222222') {
        const link = new FakeElement(['a[href]']);
        link.setAttribute('href', `https://gmgn.ai/${chain}/token/${address}`);
        link.href = link.getAttribute('href');
        card.appendChild(link);
      },
      reconcile() {
        const evidence = guardContext.Tango.GMGN._cardAddressEvidence(card, chain);
        if (!evidence) return false;
        return guardContext.Tango.GMGN._activatePendingQuickBuy(slot, binding, {
          card, nativeControl: null, chain, chainDefinition,
          address: evidence.address, bindingKey: `${chain}:${evidence.address}`,
          href: evidence.href, amountNative, paperLabel: 'PAPER', policyKey,
          onQuickBuy, now: clock.now
        });
      }
    };
  }

  function replaceNativeAncestor(slot) {
    const card = slot.__tangoQuickBuyCard;
    const oldRoot = card.parentElement;
    const nextRoot = new FakeElement(['[data-sentry-component="BuyButtons"]']);
    oldRoot.removeChild(card);
    nextRoot.appendChild(card);
    addNativeSentinels(nextRoot);
    return nextRoot;
  }

  const useCapture = (options) => options === true || options?.capture === true;
  function addNativeSentinels(element) {
    for (const type of [
      'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup',
      'touchstart', 'touchend', 'click', 'auxclick', 'keydown', 'keyup'
    ]) {
      element.addEventListener(type, () => { nativeCaptureCalls += 1; }, { capture: true });
      element.addEventListener(type, () => { nativeBubbleCalls += 1; });
    }
  }

  function dispatchTrusted(type, target, overrides = {}) {
    const event = {
      type, target, key: '', button: 0, isPrimary: true, pointerId: 1,
      detail: type === 'click' ? 1 : 0, isTrusted: true,
      composedPath: () => {
        const nodes = [];
        for (let node = target; node; node = node.parentElement) nodes.push(node);
        return nodes;
      },
      ...overrides
    };
    const state = { stopped: false, immediate: false };
    event.preventDefault = () => {};
    event.stopPropagation = () => { state.stopped = true; };
    event.stopImmediatePropagation = () => { state.immediate = true; state.stopped = true; };
    const elements = event.composedPath();
    const invoke = (entries) => {
      for (const entry of entries) {
        entry.listener(event);
        if (state.immediate) return false;
      }
      return !state.stopped;
    };
    if (!invoke(registrations.filter((entry) => entry.type === type && useCapture(entry.options)))) {
      return state;
    }
    for (const element of [...elements].reverse()) {
      if (!invoke((element.listeners.get(type) || []).filter((entry) => useCapture(entry.options)))) {
        return state;
      }
    }
    for (const element of elements) {
      if (!invoke((element.listeners.get(type) || []).filter((entry) => !useCapture(entry.options)))) {
        return state;
      }
    }
    invoke(registrations.filter((entry) => entry.type === type && !useCapture(entry.options)));
    return state;
  }

  function dispatchTrustedPair(paper) {
    dispatchTrusted('pointerdown', paper, { pointerId: 11 });
    dispatchTrusted('pointerup', paper, { pointerId: 11 });
  }

  function mutateCore(mounted, drift) {
    if (drift === 'actionId') mounted.paper.dataset.tangoActionId = 'page-spoof';
    if (drift === 'bindingNonce') mounted.paper.dataset.tangoBindingNonce = 'page-spoof';
    if (drift === 'card') mounted.slot.__tangoQuickBuyCard = new FakeElement();
    if (drift === 'slot') mounted.slot.__tangoReplacementQuickBuy = new FakeElement();
    if (drift === 'chain') mounted.binding.chain = 'eth';
    if (drift === 'address') mounted.binding.address = EVM_ADDRESS.replace(/1$/, '2');
  }

  return {
    mountReadyPaper, mountResolvingPaper, replaceNativeAncestor,
    dispatchTrusted, dispatchTrustedPair, mutateCore,
    paperOrders,
    paperAssets,
    clock,
    setRoute(href) { guardContext.location.href = href; },
    deliver(message) {
      relayIsolatedMessage(message);
    },
    poisonExportedDispatcher() {
      guardContext.Tango.GMGN._invokeQuickBuyAction = () => {
        throw new Error('MAIN relay bypassed the production message listener');
      };
    },
    get paperCallbacks() { return paperCallbacks; },
    get nativeCaptureCalls() { return nativeCaptureCalls; },
    get nativeBubbleCalls() { return nativeBubbleCalls; }
  };
}

test('React ancestor replacement never exposes a native callback or duplicates paper activation', () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountReadyPaper({ chain: 'base', address: EVM_ADDRESS, amountNative: 1 });

  world.replaceNativeAncestor(mounted.slot, 'before-down');
  world.dispatchTrusted('pointerdown', mounted.paper, { pointerId: 11 });
  world.replaceNativeAncestor(mounted.slot, 'between-down-up');
  world.dispatchTrusted('pointerup', mounted.paper, { pointerId: 11 });
  world.replaceNativeAncestor(mounted.slot, 'after-activation');

  assert.equal(world.paperOrders.length, 1);
  assert.equal(world.paperCallbacks, 1);
  assert.equal(world.nativeCaptureCalls, 0);
  assert.equal(world.nativeBubbleCalls, 0);
});

test('MAIN postMessage crosses the production isolated message listener before the action map', () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountReadyPaper({ chain: 'base', address: EVM_ADDRESS });
  world.poisonExportedDispatcher();
  world.dispatchTrustedPair(mounted.paper);
  assert.equal(world.paperCallbacks, 1);
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
    assert.equal(world.paperCallbacks, 0);
    assert.equal(world.nativeCaptureCalls + world.nativeBubbleCalls, 0);
  });
}

test('resolving publication accepts a MAIN-world message without invoking paper or native callbacks', () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountResolvingPaper();
  world.dispatchTrustedPair(mounted.paper);
  assert.equal(world.paperOrders.length, 1);
  assert.equal(world.paperCallbacks, 0);
  assert.equal(mounted.paper.dataset.tangoPaperState, 'resolving-identity');
  assert.equal(mounted.paper.disabled, false);
  assert.equal(world.nativeCaptureCalls, 0);
  assert.equal(world.nativeBubbleCalls, 0);
});

test('href present immediately before MAIN resolving dispatch promotes and calls real onQuickBuy once', async () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountResolvingPaper();
  mounted.exposeHref();
  world.dispatchTrustedPair(mounted.paper);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(world.paperCallbacks, 1);
  assert.equal(world.paperOrders.length, 1);
  assert.ok(['ready', 'in-flight'].includes(mounted.paper.dataset.tangoPaperState));
  assert.equal(mounted.paper.disabled, false);
  assert.equal(world.nativeCaptureCalls, 0);
  assert.equal(world.nativeBubbleCalls, 0);
});

for (const [elapsed, expectedCallbacks] of [[300, 1], [301, 0]]) {
  test(`MAIN-world resolving completion at ${elapsed} ms invokes ${expectedCallbacks} paper callback`, async () => {
    const world = loadIntegratedQuickBuyWorld();
    const mounted = world.mountResolvingPaper();
    world.dispatchTrustedPair(mounted.paper);
    world.clock.now = 1_000 + elapsed;
    mounted.exposeHref();
    mounted.reconcile();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(world.paperCallbacks, expectedCallbacks);
    assert.equal(world.nativeCaptureCalls, 0);
    assert.equal(world.nativeBubbleCalls, 0);
  });
}

test('real Guard registration failure restores resolving publication and retries within TTL', async () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountResolvingPaper();
  world.dispatchTrustedPair(mounted.paper);
  mounted.exposeHref();
  const originalContains = mounted.card.contains.bind(mounted.card);
  let failOnce = true;
  mounted.card.contains = (element) => {
    if (failOnce) { failOnce = false; return false; }
    return originalContains(element);
  };
  mounted.reconcile();
  assert.equal(mounted.slot.__tangoQuickBuyBinding, mounted.binding);
  assert.equal(mounted.paper.dataset.tangoPublished, '1');
  assert.equal(world.paperCallbacks, 0);
  mounted.reconcile();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(world.paperCallbacks, 1);
  assert.equal(world.nativeCaptureCalls, 0);
  assert.equal(world.nativeBubbleCalls, 0);
});

test('twenty duplicated and reordered MAIN messages execute at most one real paper callback', async () => {
  const world = loadIntegratedQuickBuyWorld();
  const mounted = world.mountResolvingPaper();
  mounted.exposeHref();
  const intentMessage = {
    source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_INTENT',
    actionId: mounted.actionId, bindingNonce: mounted.bindingNonce
  };
  for (let index = 0; index < 20; index += 1) world.deliver(intentMessage);
  const readyMessage = {
    source: 'TANGO_GMGN_PAGE', type: 'PAPER_QUICK_BUY_CLICK',
    actionId: mounted.paper.dataset.tangoActionId,
    bindingNonce: mounted.paper.dataset.tangoBindingNonce
  };
  for (let index = 0; index < 20; index += 1) {
    world.deliver(index % 2 ? intentMessage : readyMessage);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(world.paperCallbacks <= 1);
  assert.equal(world.paperCallbacks, 1);
  assert.equal(world.nativeCaptureCalls, 0);
  assert.equal(world.nativeBubbleCalls, 0);
});

const worldIdentityDrifts = {
  card(_world, mounted) { mounted.binding.card = mounted.root; },
  slot(_world, mounted) { mounted.binding.birth.slot = mounted.root; },
  root(_world, mounted) { mounted.birthRoot.isConnected = false; },
  generation(_world, mounted) { mounted.binding.generation += 1; },
  nonce(_world, mounted) { mounted.binding.bindingNonce = 'drifted-nonce'; },
  chain(_world, mounted) { mounted.binding.chain = 'eth'; },
  amount(_world, mounted) { mounted.binding.amountNative = 2; },
  route(world) { world.setRoute('https://gmgn.ai/?chain=base&tab=renamed'); },
  settings(_world, mounted) { mounted.binding.policyKey = 'policy:disabled'; },
  disconnect(_world, mounted) { mounted.card.isConnected = false; },
  'conflicting-href'(_world, mounted) { mounted.addConflictingHref(EVM_ADDRESS_2); },
  'href-removed'() {},
  'href-rewritten'() {},
  'pre-existing-attribute-hydration'(_world, mounted) { mounted.binding.birth = null; }
};

for (const [drift, applyDrift] of Object.entries(worldIdentityDrifts)) {
  test(`world identity intent ${drift} drift preserves assets and reaches zero native listeners`, async () => {
    const world = loadIntegratedQuickBuyWorld();
    const mounted = world.mountResolvingPaper();
    if (drift === 'pre-existing-attribute-hydration') applyDrift(world, mounted);
    world.dispatchTrustedPair(mounted.paper);
    if (drift !== 'pre-existing-attribute-hydration') applyDrift(world, mounted);

    if (drift === 'href-removed' || drift === 'href-rewritten') {
      mounted.exposeHref();
      mounted.reconcile();
      if (drift === 'href-removed') mounted.removeHref();
      else mounted.exposeHref(EVM_ADDRESS_2);
    } else {
      mounted.exposeHref();
      mounted.reconcile();
    }
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(world.paperCallbacks, 0);
    assert.deepEqual(world.paperAssets, {
      cash: 4_242,
      positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
      trades: [{ id: 'sentinel-trade', side: 'BUY' }],
      markers: [{ id: 'sentinel-marker', price: 11 }]
    });
    assert.equal(world.nativeCaptureCalls, 0);
    assert.equal(world.nativeBubbleCalls, 0);
  });
}
