const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/content/page-main.js'), 'utf8');
const chainsSource = fs.readFileSync(path.resolve(__dirname, '../src/core/chains.js'), 'utf8');
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function loadPageMain(fetchImpl, clock = null) {
  const published = [];
  const nativePublished = [];
  const nativeExtractionCalls = [];
  const paperPublished = [];
  const listeners = new Map();
  const listenerRegistrations = [];
  class FakeElement {}
  const documentElementClasses = new Set();
  class FakeXhr {
    constructor() { this.listeners = new Map(); this.status = 0; this.responseType = ''; this.responseText = ''; }
    open() {}
    send() {}
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    getResponseHeader() { return 'application/json'; }
    dispatch(type) { this.listeners.get(type)?.(); }
  }
  const context = {
    console,
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
    Element: FakeElement,
    URL,
    XMLHttpRequest: FakeXhr,
    document: {
      documentElement: {
        classList: {
          add: (...names) => names.forEach((name) => documentElementClasses.add(name)),
          remove: (...names) => names.forEach((name) => documentElementClasses.delete(name)),
          contains: (name) => documentElementClasses.has(name)
        }
      }
    },
    location: { href: `https://gmgn.ai/eth/token/${EVM_ADDRESS}` },
    fetch: fetchImpl,
    addEventListener(type, listener, options) {
      listeners.set(type, listener);
      listenerRegistrations.push({ type, listener, options });
    },
    postMessage(message) {
      if (message?.type === 'TOKEN_QUOTES') published.push(...message.quotes);
      if (message?.type === 'NATIVE_PRICES') nativePublished.push(...message.prices);
      if (message?.type === 'PAPER_QUICK_BUY_INTENT' || message?.type === 'PAPER_QUICK_BUY_CLICK') {
        paperPublished.push({ ...message });
      }
    },
    Tango: {
      GMGNQuotes: {
        extract(payload, chain, observedAt) {
          return [{
            chain, address: payload.address, priceUsd: payload.priceUsd,
            symbol: payload.symbol || '', name: payload.name || '', logoUrl: payload.logoUrl || '',
            observedAt, source: 'GMGN_NETWORK'
          }];
        },
        extractNativePrices(payload, observedAt, trustContext = {}) {
          nativeExtractionCalls.push({ payload, observedAt, trustContext });
          let allowGenericPrice = false;
          try {
            const parsed = new URL(String(trustContext.requestUrl || ''));
            allowGenericPrice = parsed.protocol === 'https:'
              && (parsed.hostname === 'gmgn.ai' || parsed.hostname.endsWith('.gmgn.ai'))
              && parsed.pathname === '/api/v1/major_coin_prices';
          } catch {}
          return (payload.data || [])
            .filter((entry) => ['SOL', 'ETH', 'BNB', 'OKB'].includes(entry.symbol))
            .map((entry) => ({
              symbol: entry.symbol,
              priceUsd: Number(entry.price_usd || (allowGenericPrice ? entry.price : 0)),
              observedAt,
              source: 'GMGN_MAJOR_COIN'
            }))
            .filter((entry) => entry.priceUsd > 0);
        },
        mergeObservation(previous, next) {
          if (previous && (previous.chain !== next.chain || previous.address !== next.address)) return null;
          if (previous && Number(next.observedAt || 0) < Number(previous.observedAt || 0)) return previous;
          return {
            ...(previous || {}), ...next,
            priceUsd: next.priceUsd || previous?.priceUsd || 0,
            symbol: next.symbol || previous?.symbol || '',
            name: next.name || previous?.name || '',
            logoUrl: next.logoUrl || previous?.logoUrl || ''
          };
        }
      }
    }
  };
  context.__listeners = listeners;
  context.window = context;
  context.top = context;
  vm.runInNewContext(chainsSource, context, { filename: 'src/core/chains.js' });
  vm.runInNewContext(source, context, { filename: 'src/content/page-main.js' });
  return {
    context, published, nativePublished, nativeExtractionCalls, paperPublished,
    listeners, listenerRegistrations, documentElementClasses
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

function dispatchPaper(loaded, type, button, overrides = {}) {
  return dispatchCaptured(loaded, {
    type, target: button, button: 0, isPrimary: true, pointerId: 1,
    detail: type === 'click' ? 1 : 0, isTrusted: true,
    composedPath: () => [button], ...overrides
  });
}

test('native GMGN quick buy and the leafless bound-slot repair window are capture-blocked until explicit OFF', () => {
  const loaded = loadPageMain(async () => jsonResponse({}));
  const nativeControl = new loaded.context.Element();
  nativeControl.matches = (selector) => selector === '[data-testid="quickbuy"]';
  const nativeSlot = new loaded.context.Element();
  nativeSlot.matches = (selector) => selector === '.BuyButton-continer';
  const buyButtonsRoot = new loaded.context.Element();
  buyButtonsRoot.matches = (selector) => selector === '[data-sentry-component="BuyButtons"]';
  const untaggedNativeControl = new loaded.context.Element();
  untaggedNativeControl.matches = () => false;
  const paperControl = new loaded.context.Element();
  paperControl.dataset = {
    tangoActionId: 'paper-slot-action', tangoBindingNonce: 'nonce-paper-slot', tangoPaperState: 'ready'
  };
  paperControl.matches = (selector) => selector === '[data-tango-paper-action="quick-buy"]';
  const dispatch = (type, key = '', path = [nativeControl]) => {
    const state = { prevented: false, stopped: false, immediate: false };
    const event = {
      type,
      target: path[0],
      button: 0,
      key,
      composedPath: () => path,
      preventDefault: () => { state.prevented = true; },
      stopPropagation: () => { state.stopped = true; },
      stopImmediatePropagation: () => { state.immediate = true; }
    };
    loaded.listenerRegistrations
      .filter((entry) => entry.type === type && entry.options?.capture)
      .forEach((entry) => {
        if (!state.immediate) entry.listener(event);
      });
    return state;
  };

  assert.deepEqual(dispatch('pointerdown'), { prevented: true, stopped: true, immediate: true });
  assert.deepEqual(dispatch('click'), { prevented: true, stopped: true, immediate: true });
  assert.deepEqual(
    dispatch('click', '', [new loaded.context.Element(), nativeSlot]),
    { prevented: true, stopped: true, immediate: true }
  );
  assert.equal(loaded.paperPublished.length, 0, 'a leafless slot blocks card navigation without publishing an order');
  assert.deepEqual(
    dispatch('click', '', [untaggedNativeControl, buyButtonsRoot]),
    { prevented: true, stopped: true, immediate: true }
  );
  assert.deepEqual(dispatch('keydown', 'Enter'), { prevented: true, stopped: true, immediate: true });
  assert.deepEqual(dispatch('keydown', 'a'), { prevented: false, stopped: false, immediate: false });
  assert.deepEqual(
    dispatch('click', '', [paperControl, nativeSlot]),
    { prevented: true, stopped: true, immediate: true }
  );
  assert.equal(loaded.paperPublished.length, 1);

  loaded.context.document.documentElement.classList.add('tango-paper-native-quick-buy-allowed');
  assert.deepEqual(dispatch('click'), { prevented: false, stopped: false, immediate: false });
  assert.equal(loaded.paperPublished.length, 1);
});

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

  const missingPrimaryButton = makePaper(loaded, {
    actionId: 'action-2', bindingNonce: 'nonce-4', state: 'resolving-identity'
  });
  dispatchPaper(loaded, 'click', missingPrimaryButton, {
    target: missingPrimaryButton, button: undefined, detail: 0, isTrusted: true
  });
  assert.equal(loaded.paperPublished.length, 1);
});

test('paper quick-buy rejects auxiliary non-primary drag-in and repeated activation', () => {
  const clock = { now: 1_000 };
  const loaded = loadPageMain(async () => jsonResponse({}), clock);
  const makePaper = (actionId) => {
    const control = new loaded.context.Element();
    control.dataset = {
      tangoActionId: actionId, tangoBindingNonce: `nonce-${actionId}`, tangoPaperState: 'ready'
    };
    control.matches = (selector) => selector === '[data-tango-paper-action="quick-buy"]';
    return control;
  };
  const outside = new loaded.context.Element();
  outside.matches = () => false;
  const dispatch = (type, target, overrides = {}) => {
    const state = { prevented: false, stopped: false, immediate: false };
    const event = {
      type,
      target,
      key: '',
      repeat: false,
      button: 0,
      buttons: 0,
      isPrimary: true,
      pointerId: 1,
      detail: type === 'click' ? 1 : 0,
      isTrusted: true,
      composedPath: () => [target],
      preventDefault: () => { state.prevented = true; },
      stopPropagation: () => { state.stopped = true; },
      stopImmediatePropagation: () => { state.immediate = true; },
      ...overrides
    };
    loaded.listenerRegistrations
      .filter((entry) => entry.type === type && entry.options?.capture)
      .forEach((entry) => {
        if (!state.immediate) entry.listener(event);
      });
    return state;
  };
  const assertBlocked = (state, label) => assert.deepEqual(
    state, { prevented: true, stopped: true, immediate: true }, label
  );

  const auxRegistration = loaded.listenerRegistrations.find((entry) => entry.type === 'auxclick');
  assert.ok(auxRegistration);
  assert.equal(auxRegistration.options?.capture, true);
  assert.equal(auxRegistration.options?.passive, false);
  const cancelRegistration = loaded.listenerRegistrations.find((entry) => entry.type === 'pointercancel');
  assert.ok(cancelRegistration);
  assert.equal(cancelRegistration.options?.capture, true);
  assert.equal(cancelRegistration.options?.passive, false);

  const dragIn = makePaper('drag-in');
  dispatch('pointerdown', outside, { pointerId: 7 });
  assertBlocked(dispatch('pointerup', dragIn, { pointerId: 7 }), 'drag-in pointerup');
  assert.equal(loaded.paperPublished.length, 0);

  const cancelled = makePaper('cancelled');
  assertBlocked(dispatch('pointerdown', cancelled, { pointerId: 70 }), 'cancelled down');
  assertBlocked(dispatch('pointercancel', cancelled, { pointerId: 70 }), 'pointer cancel');
  assertBlocked(dispatch('pointerup', cancelled, { pointerId: 70 }), 'cancelled pointerup');
  assert.equal(loaded.paperPublished.length, 0);

  const middle = makePaper('middle');
  assertBlocked(dispatch('pointerdown', middle, { pointerId: 8, button: 1 }), 'middle down');
  assertBlocked(dispatch('pointerup', middle, { pointerId: 8, button: 1 }), 'middle up');
  assertBlocked(dispatch('auxclick', middle, { pointerId: 8, button: 1, detail: 1 }), 'middle auxclick');
  assert.equal(loaded.paperPublished.length, 0);

  const right = makePaper('right');
  assertBlocked(dispatch('pointerdown', right, { pointerId: 9, button: 2 }), 'right down');
  assertBlocked(dispatch('pointerup', right, { pointerId: 9, button: 2 }), 'right up');
  assertBlocked(dispatch('auxclick', right, { pointerId: 9, button: 2, detail: 1 }), 'right auxclick');
  assert.equal(loaded.paperPublished.length, 0);

  const nonPrimary = makePaper('non-primary');
  assertBlocked(dispatch('pointerdown', nonPrimary, { pointerId: 10, isPrimary: false }), 'non-primary down');
  assertBlocked(dispatch('pointerup', nonPrimary, { pointerId: 10, isPrimary: false }), 'non-primary up');
  assert.equal(loaded.paperPublished.length, 0);

  const repeatedKey = makePaper('repeat');
  assertBlocked(dispatch('keydown', repeatedKey, { key: 'Enter', repeat: true }), 'repeat keydown');
  assert.equal(loaded.paperPublished.length, 0, 'repeat keydown must not authorize or publish');
  assertBlocked(dispatch('keyup', repeatedKey, { key: 'Enter', repeat: false }), 'repeat-only keyup');
  assert.equal(loaded.paperPublished.length, 0);

  const primary = makePaper('primary');
  assertBlocked(dispatch('pointerdown', primary, { pointerId: 11 }), 'primary down');
  assertBlocked(dispatch('pointerup', primary, { pointerId: 11 }), 'primary up');
  assert.equal(loaded.paperPublished.length, 1);

  clock.now += 701;
  const keyboard = makePaper('keyboard');
  assertBlocked(dispatch('keydown', keyboard, { key: ' ', repeat: false }), 'keyboard down');
  assertBlocked(dispatch('keyup', keyboard, { key: ' ', repeat: false }), 'keyboard up');
  assert.equal(loaded.paperPublished.length, 2);

  clock.now += 701;
  const semanticClick = makePaper('semantic-click');
  assertBlocked(dispatch('click', semanticClick, { button: 0, detail: 0, isTrusted: true }), 'semantic click');
  assert.equal(loaded.paperPublished.length, 3);

  clock.now += 701;
  const unsafeClick = makePaper('unsafe-click');
  assertBlocked(dispatch('click', unsafeClick, { button: 0, detail: 1, isTrusted: true }), 'unmatched mouse click');
  assertBlocked(dispatch('click', unsafeClick, { button: 0, detail: 0, isTrusted: false }), 'untrusted click');
  assert.equal(loaded.paperPublished.length, 3);
});

test('paper quick-buy keeps a valid keydown authorization through held-key repeats', () => {
  const loaded = loadPageMain(async () => jsonResponse({}));
  const button = new loaded.context.Element();
  button.dataset = {
    tangoActionId: 'held-enter', tangoBindingNonce: 'nonce-held-enter', tangoPaperState: 'ready'
  };
  button.matches = (selector) => selector === '[data-tango-paper-action="quick-buy"]';
  const dispatch = (type, repeat) => {
    const state = { prevented: false, stopped: false, immediate: false };
    loaded.listeners.get(type)({
      type,
      key: 'Enter',
      repeat,
      isTrusted: true,
      composedPath: () => [button],
      preventDefault: () => { state.prevented = true; },
      stopPropagation: () => { state.stopped = true; },
      stopImmediatePropagation: () => { state.immediate = true; }
    });
    assert.deepEqual(state, { prevented: true, stopped: true, immediate: true });
  };

  dispatch('keydown', false);
  dispatch('keydown', true);
  dispatch('keydown', true);
  assert.equal(loaded.paperPublished.length, 0, 'repeat keydowns must never publish');

  dispatch('keyup', false);
  assert.equal(loaded.paperPublished.length, 1);
});

test('paper quick-buy real dispatch blocks every native leaf and delegated ancestor sentinel', () => {
  const clock = { now: 1_000 };
  const loaded = loadPageMain(async () => jsonResponse({}), clock);
  const protectedEvents = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'keydown', 'keyup'];
  for (const type of protectedEvents) {
    const registration = loaded.listenerRegistrations.find((entry) => entry.type === type);
    assert.ok(registration, `${type} must be registered`);
    assert.equal(registration.options?.capture, true, `${type} must capture`);
    assert.equal(registration.options?.passive, false, `${type} must allow preventDefault`);
  }

  const capture = (options) => options === true || options?.capture === true;
  const listenersFor = (node, type) => node === loaded.context
    ? loaded.listenerRegistrations.filter((entry) => entry.type === type)
    : (node.__listeners.get(type) || []);
  class MiniElement extends loaded.context.Element {
    constructor(name, parentNode = null, paperAction = false) {
      super();
      this.name = name;
      this.parentNode = parentNode;
      this.dataset = paperAction
        ? { tangoActionId: 'paper-1', tangoBindingNonce: 'nonce-paper-1', tangoPaperState: 'ready' }
        : {};
      this.paperAction = paperAction;
      this.__listeners = new Map();
    }
    matches(selector) {
      return this.paperAction && selector === '[data-tango-paper-action="quick-buy"]';
    }
    addEventListener(type, listener, options = false) {
      const entries = this.__listeners.get(type) || [];
      entries.push({ type, listener, options });
      this.__listeners.set(type, entries);
    }
    dispatchEvent(event) {
      const path = [];
      for (let node = this; node; node = node.parentNode) path.push(node);
      path.push(loaded.context);
      event.target = this;
      event.currentTarget = null;
      event.defaultPrevented = false;
      event.propagationStopped = false;
      event.immediateStopped = false;
      event.composedPath = () => [...path];
      event.preventDefault = () => { event.defaultPrevented = true; };
      event.stopPropagation = () => { event.propagationStopped = true; };
      event.stopImmediatePropagation = () => {
        event.immediateStopped = true;
        event.propagationStopped = true;
      };
      const invoke = (node, useCapture) => {
        event.currentTarget = node;
        for (const entry of listenersFor(node, event.type)) {
          if (capture(entry.options) !== useCapture) continue;
          entry.listener.call(node, event);
          if (event.immediateStopped) break;
        }
      };
      for (let index = path.length - 1; index > 0; index -= 1) {
        invoke(path[index], true);
        if (event.propagationStopped) return !event.defaultPrevented;
      }
      invoke(path[0], true);
      if (!event.immediateStopped) invoke(path[0], false);
      if (event.propagationStopped) return !event.defaultPrevented;
      for (let index = 1; index < path.length; index += 1) {
        invoke(path[index], false);
        if (event.propagationStopped) break;
      }
      return !event.defaultPrevented;
    }
  }

  const documentNode = new MiniElement('document');
  const root = new MiniElement('root', documentNode);
  const card = new MiniElement('card', root);
  const slot = new MiniElement('slot', card);
  const unprotected = new MiniElement('unprotected', slot);
  const paperButton = new MiniElement('paper', slot, true);
  const innerLeaf = new MiniElement('inner', paperButton);
  const pendingButton = new MiniElement('pending-paper', slot, true);
  pendingButton.dataset = {};
  const pendingLeaf = new MiniElement('pending-inner', pendingButton);
  const nodes = [documentNode, root, card, slot, paperButton, innerLeaf, pendingButton, pendingLeaf];

  const baselineOrder = [];
  const record = (label) => () => baselineOrder.push(label);
  loaded.context.addEventListener('click', record('window-capture'), { capture: true });
  documentNode.addEventListener('click', record('document-capture'), { capture: true });
  root.addEventListener('click', record('root-capture'), { capture: true });
  card.addEventListener('click', record('card-capture'), { capture: true });
  slot.addEventListener('click', record('slot-capture'), { capture: true });
  unprotected.addEventListener('click', record('target-capture'), { capture: true });
  unprotected.addEventListener('click', record('target-bubble'));
  slot.addEventListener('click', record('slot-bubble'));
  card.addEventListener('click', record('card-bubble'));
  root.addEventListener('click', record('root-bubble'));
  documentNode.addEventListener('click', record('document-bubble'));
  loaded.context.addEventListener('click', record('window-bubble'));
  assert.equal(unprotected.dispatchEvent({ type: 'click', key: '' }), true);
  assert.deepEqual(baselineOrder, [
    'window-capture', 'document-capture', 'root-capture', 'card-capture', 'slot-capture',
    'target-capture', 'target-bubble', 'slot-bubble', 'card-bubble', 'root-bubble',
    'document-bubble', 'window-bubble'
  ]);
  baselineOrder.length = 0;

  let nativeSentinelCalls = 0;
  const nativeSentinel = () => { nativeSentinelCalls += 1; };
  for (const type of protectedEvents) {
    loaded.context.addEventListener(type, nativeSentinel, { capture: true });
    loaded.context.addEventListener(type, nativeSentinel);
    for (const node of nodes) {
      node.addEventListener(type, nativeSentinel, { capture: true });
      node.addEventListener(type, nativeSentinel);
    }
  }
  const dispatchBlocked = (target, type, key = '') => {
    const event = { type, key };
    assert.equal(target.dispatchEvent(event), false, type);
    assert.equal(event.defaultPrevented, true, type);
    assert.equal(event.immediateStopped, true, type);
  };

  dispatchBlocked(innerLeaf, 'pointerdown');
  dispatchBlocked(innerLeaf, 'pointerup');
  dispatchBlocked(innerLeaf, 'click');
  clock.now += 701;
  dispatchBlocked(paperButton, 'keydown', 'Enter');
  dispatchBlocked(paperButton, 'keyup', 'Enter');
  dispatchBlocked(paperButton, 'click');
  clock.now += 701;
  dispatchBlocked(paperButton, 'keydown', ' ');
  dispatchBlocked(paperButton, 'keyup', ' ');
  dispatchBlocked(paperButton, 'click');
  dispatchBlocked(pendingLeaf, 'pointerdown');
  dispatchBlocked(pendingLeaf, 'click');

  assert.equal(loaded.paperPublished.length, 3);
  assert.equal(nativeSentinelCalls, 0);
  assert.deepEqual(baselineOrder, []);
});

function jsonResponse(payload, url = 'https://gmgn.ai/api/token/quote') {
  return {
    ok: true,
    url,
    headers: { get: () => 'application/json' },
    clone: () => ({ json: async () => payload })
  };
}

test('delayed fetch response keeps its request-start chain after identical-address navigation', async () => {
  const gate = deferred();
  const loaded = loadPageMain(() => gate.promise);
  const request = loaded.context.fetch('/api/token/quote');
  loaded.context.location.href = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
  gate.resolve(jsonResponse({ address: EVM_ADDRESS, priceUsd: 2 }));
  await request;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loaded.published.map((quote) => quote.chain), ['eth']);
});

test('delayed XHR response keeps its open-time chain after identical-address navigation', () => {
  const loaded = loadPageMain(async () => jsonResponse({}));
  const xhr = new loaded.context.XMLHttpRequest();
  xhr.open('GET', '/api/token/quote');
  xhr.send();
  loaded.context.location.href = `https://gmgn.ai/base/token/${EVM_ADDRESS}`;
  xhr.status = 200;
  xhr.responseText = JSON.stringify({ address: EVM_ADDRESS, priceUsd: 3 });
  xhr.dispatch('load');
  assert.deepEqual(loaded.published.map((quote) => quote.chain), ['eth']);
});

test('absolute GMGN subdomain requests use their explicit chain instead of the page chain', async () => {
  const loaded = loadPageMain(async () => jsonResponse(
    { address: EVM_ADDRESS, priceUsd: 4 },
    'https://api.gmgn.ai/base/token/quote'
  ));
  await loaded.context.fetch('https://api.gmgn.ai/base/token/quote');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loaded.published.map((quote) => quote.chain), ['base']);
});

test('a GMGN subdomain redirect with a conflicting explicit chain is rejected', async () => {
  const loaded = loadPageMain(async () => jsonResponse(
    { address: EVM_ADDRESS, priceUsd: 5 },
    'https://api.gmgn.ai/base/token/quote'
  ));
  await loaded.context.fetch('https://api.gmgn.ai/eth/token/quote');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loaded.published, []);
});

test('quote replay preserves metadata when a later response contains only price', async () => {
  const responses = [
    { address: EVM_ADDRESS, priceUsd: 2, symbol: 'RIGHT', name: 'Right Token', logoUrl: 'right.png' },
    { address: EVM_ADDRESS, priceUsd: 3, symbol: '', name: '', logoUrl: '' }
  ];
  const loaded = loadPageMain(async () => jsonResponse(responses.shift()));
  await loaded.context.fetch('/api/token/quote');
  await loaded.context.fetch('/api/token/quote');
  await new Promise((resolve) => setImmediate(resolve));
  loaded.published.length = 0;

  loaded.context.__messageData = { source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' };
  vm.runInNewContext("__listeners.get('message')({ source: window, data: __messageData })", loaded.context);

  assert.equal(loaded.published.length, 1);
  assert.equal(loaded.published[0].priceUsd, 3);
  assert.equal(loaded.published[0].symbol, 'RIGHT');
  assert.equal(loaded.published[0].name, 'Right Token');
  assert.equal(loaded.published[0].logoUrl, 'right.png');
});

test('an older fetch request completing last cannot replace a newer token observation', async () => {
  const first = deferred();
  const second = deferred();
  const requests = [first, second];
  const clock = { now: 100 };
  const loaded = loadPageMain(() => requests.shift().promise, clock);

  const olderRequest = loaded.context.fetch('/api/token/quote');
  clock.now = 200;
  const newerRequest = loaded.context.fetch('/api/token/quote');
  clock.now = 300;
  second.resolve(jsonResponse({ address: EVM_ADDRESS, priceUsd: 2 }));
  await newerRequest;
  await new Promise((resolve) => setImmediate(resolve));
  clock.now = 400;
  first.resolve(jsonResponse({ address: EVM_ADDRESS, priceUsd: 1 }));
  await olderRequest;
  await new Promise((resolve) => setImmediate(resolve));

  loaded.published.length = 0;
  loaded.context.__messageData = { source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' };
  vm.runInNewContext("__listeners.get('message')({ source: window, data: __messageData })", loaded.context);
  assert.equal(loaded.published.length, 1);
  assert.equal(loaded.published[0].priceUsd, 2);
  assert.equal(loaded.published[0].observedAt, 200);
});

test('XHR request ordering follows send time rather than open time', () => {
  const clock = { now: 100 };
  const loaded = loadPageMain(async () => jsonResponse({}), clock);
  const openedFirst = new loaded.context.XMLHttpRequest();
  openedFirst.open('GET', '/api/token/quote');
  clock.now = 200;
  const openedSecond = new loaded.context.XMLHttpRequest();
  openedSecond.open('GET', '/api/token/quote');

  clock.now = 300;
  openedSecond.send();
  clock.now = 400;
  openedFirst.send();
  openedFirst.status = 200;
  openedFirst.responseText = JSON.stringify({ address: EVM_ADDRESS, priceUsd: 4 });
  openedFirst.dispatch('load');
  clock.now = 500;
  openedSecond.status = 200;
  openedSecond.responseText = JSON.stringify({ address: EVM_ADDRESS, priceUsd: 3 });
  openedSecond.dispatch('load');

  loaded.published.length = 0;
  loaded.context.__messageData = { source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES' };
  vm.runInNewContext("__listeners.get('message')({ source: window, data: __messageData })", loaded.context);
  assert.equal(loaded.published.length, 1);
  assert.equal(loaded.published[0].priceUsd, 4);
  assert.equal(loaded.published[0].observedAt, 400);
});

test('major_coin_prices publishes passive native observations without a new request', async () => {
  const loaded = loadPageMain(async () => jsonResponse(
    { data: [{ symbol: 'ETH', price: 3500 }] },
    'https://gmgn.ai/api/v1/major_coin_prices'
  ));
  await loaded.context.fetch('/api/v1/major_coin_prices');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loaded.nativePublished, [{
    symbol: 'ETH', priceUsd: 3500, observedAt: loaded.nativePublished[0].observedAt,
    source: 'GMGN_MAJOR_COIN'
  }]);
  assert.equal(
    loaded.nativeExtractionCalls[0].trustContext.requestUrl,
    'https://gmgn.ai/api/v1/major_coin_prices'
  );
});

test('major_coin_prices publishes on a chainless GMGN page', async () => {
  const loaded = loadPageMain(async () => jsonResponse(
    { data: [{ symbol: 'ETH', price: 3500 }] },
    'https://gmgn.ai/api/v1/major_coin_prices'
  ));
  loaded.context.location.href = 'https://gmgn.ai/';
  await loaded.context.fetch('/api/v1/major_coin_prices');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded.nativePublished.length, 1);
  assert.deepEqual(loaded.nativePublished[0], {
    symbol: 'ETH', priceUsd: 3500, observedAt: loaded.nativePublished[0].observedAt,
    source: 'GMGN_MAJOR_COIN'
  });
});

test('a lookalike major-coin path cannot authorize generic native price extraction', async () => {
  const loaded = loadPageMain(async () => jsonResponse(
    { data: [{ symbol: 'ETH', price: 3500 }] },
    'https://gmgn.ai/not-api/api/v1/major_coin_prices'
  ));
  await loaded.context.fetch('/not-api/api/v1/major_coin_prices');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(loaded.nativePublished, []);
  assert.equal(loaded.nativeExtractionCalls.length, 0);
});

test('a token endpoint cannot authorize a generic native price field', async () => {
  const loaded = loadPageMain(async () => jsonResponse(
    { data: [{ address: EVM_ADDRESS, symbol: 'ETH', price: 3500 }] },
    'https://gmgn.ai/api/v1/token_price'
  ));
  await loaded.context.fetch('/api/v1/token_price');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(loaded.nativePublished, []);
  assert.equal(loaded.nativeExtractionCalls.length, 0);
});

test('page tap does not create a WebSocket or include GMGN execution endpoints', () => {
  assert.doesNotMatch(source, /new\s+WebSocket\s*\(/);
  assert.doesNotMatch(source, /strategy_order|wallet\/list|swap\/route|sendTransaction|signTransaction/);
});
