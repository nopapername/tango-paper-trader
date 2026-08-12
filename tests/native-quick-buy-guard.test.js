const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const constantsSource = fs.readFileSync(
  path.resolve(__dirname, '../src/shared/constants.js'), 'utf8'
);
const guardPath = path.resolve(__dirname, '../src/content/native-quick-buy-guard.js');
const guardSource = fs.existsSync(guardPath) ? fs.readFileSync(guardPath, 'utf8') : '';
const adapterSource = fs.readFileSync(path.resolve(__dirname, '../src/adapters/gmgn.js'), 'utf8');
const SETTINGS_KEY = 'tangoPaperTraderSettingsV1';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function loadGuard(readResult) {
  const registrations = [];
  const storageReads = [];
  let storageListener = null;
  const rootClasses = new Set(['tango-paper-native-quick-buy-allowed']);
  class FakeElement {
    constructor(selectors = []) {
      this.selectors = new Set(selectors);
      this.dataset = {};
      this.isConnected = true;
      this.children = new Set();
      this.parentElement = null;
    }
    matches(selector) { return this.selectors.has(selector); }
    contains(element) {
      if (element === this) return true;
      return [...this.children].some((child) => child.contains(element));
    }
    appendChild(element) {
      if (element.parentElement && element.parentElement !== this) {
        element.parentElement.children.delete(element);
      }
      element.parentElement = this;
      this.children.add(element);
      return element;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (node.matches(selector)) return node;
      }
      return null;
    }
    removeChild(element) {
      if (!this.children.delete(element)) throw new Error('Element is not a child');
      if (element.parentElement === this) element.parentElement = null;
      return element;
    }
  }
  const context = {
    console,
    Element: FakeElement,
    document: {
      documentElement: {
        classList: { contains: (name) => rootClasses.has(name) }
      }
    },
    chrome: {
      storage: {
        local: {
          get(key) {
            storageReads.push(key);
            return readResult;
          }
        },
        onChanged: {
          addListener(listener) { storageListener = listener; }
        }
      }
    },
    addEventListener(type, listener, options) {
      registrations.push({ type, listener, options });
    }
  };
  context.window = context;
  vm.runInNewContext(constantsSource, context, { filename: 'src/shared/constants.js' });
  vm.runInNewContext(guardSource, context, { filename: 'src/content/native-quick-buy-guard.js' });

  function dispatch(type, pathNodes, overrides = {}) {
    const state = { prevented: false, stopped: false, immediate: false };
    const event = {
      type,
      key: '',
      composedPath: () => pathNodes,
      preventDefault: () => { state.prevented = true; },
      stopPropagation: () => { state.stopped = true; },
      stopImmediatePropagation: () => { state.immediate = true; },
      ...overrides
    };
    for (const registration of registrations.filter((entry) => entry.type === type)) {
      if (!state.immediate) registration.listener(event);
    }
    return state;
  }

  return {
    context,
    registrations,
    storageReads,
    rootClasses,
    dispatch,
    change(changes, area = 'local') { storageListener?.(changes, area); },
    FakeElement
  };
}

function assertBlocked(state, label) {
  assert.deepEqual(state, { prevented: true, stopped: true, immediate: true }, label);
}

function assertAllowed(state, label) {
  assert.deepEqual(state, { prevented: false, stopped: false, immediate: false }, label);
}

function paperIdentity(loaded, actionId, patch = {}) {
  const address = '0x1111111111111111111111111111111111111111';
  const element = new loaded.FakeElement(['[data-tango-paper-action="quick-buy"]']);
  const slot = new loaded.FakeElement(['.BuyButton-continer']);
  const card = new loaded.FakeElement(['[class~="group/a"]']);
  const state = patch.state || 'ready';
  const generation = Number(patch.generation || 1);
  const bindingNonce = patch.bindingNonce || `nonce-${generation}`;
  const activate = patch.activate || (() => undefined);
  const validate = patch.validate || (() => true);
  const binding = {
    replacement: element, slot, card, actionId, bindingNonce, generation, state,
    chain: 'base', address, href: `https://gmgn.ai/base/token/${address}`,
    amountNative: 1, validate, action: {
      bindingNonce, kind: state === 'resolving-identity' ? 'intent' : 'execute', invoke: activate
    }
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
    amountNative: binding.amountNative, validate
  };
}

test('isolated native guard is fail-closed against page class and action spoofing', async () => {
  const initialRead = deferred();
  const loaded = loadGuard(initialRead.promise);
  assert.deepEqual(loaded.storageReads, [SETTINGS_KEY]);

  for (const type of [
    'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup',
    'touchstart', 'touchend', 'click', 'auxclick', 'keydown', 'keyup'
  ]) {
    const registration = loaded.registrations.find((entry) => entry.type === type);
    assert.ok(registration, `${type} must be registered`);
    assert.equal(registration.options?.capture, true, `${type} must capture`);
    assert.equal(registration.options?.passive, false, `${type} must allow preventDefault`);
  }

  const nativeLeaf = new loaded.FakeElement(['[data-testid="quickbuy"]']);
  assert.equal(loaded.rootClasses.has('tango-paper-native-quick-buy-allowed'), true);
  assertBlocked(loaded.dispatch('click', [nativeLeaf]), 'page-writable allow class');

  const spoofedPaper = new loaded.FakeElement(['[data-tango-paper-action="quick-buy"]']);
  const nativeSlot = new loaded.FakeElement(['.BuyButton-continer']);
  assertBlocked(loaded.dispatch('click', [spoofedPaper, nativeSlot]), 'page-writable paper marker');

  const trusted = paperIdentity(loaded, 'paper-action-1');
  loaded.context.Tango.NativeQuickBuyGuard.registerPaperAction(trusted.element, trusted, trusted.activate);
  assertBlocked(loaded.dispatch('click', [trusted.element, trusted.slot]), 'registered paper control');

  loaded.change({ [SETTINGS_KEY]: { newValue: { enabled: false } } });
  assertAllowed(loaded.dispatch('click', [nativeLeaf]), 'explicit storage OFF');
  initialRead.resolve({ [SETTINGS_KEY]: { enabled: true } });
  await Promise.resolve();
  await Promise.resolve();
  assertAllowed(loaded.dispatch('click', [nativeLeaf]), 'stale initial read cannot override newer OFF');

  loaded.change({ [SETTINGS_KEY]: { newValue: { enabled: true } } });
  assertBlocked(loaded.dispatch('click', [nativeLeaf]), 'storage ON');
  loaded.change({ [SETTINGS_KEY]: { newValue: { enabled: false } } }, 'sync');
  assertBlocked(loaded.dispatch('click', [nativeLeaf]), 'non-local changes are ignored');
});

test('isolated native guard revokes drifted paper identity until the adapter re-registers it', () => {
  const loaded = loadGuard(new Promise(() => {}));
  const guard = loaded.context.Tango.NativeQuickBuyGuard;

  const cases = [
    {
      label: 'removed paper action',
      mutate(identity) { delete identity.element.dataset.tangoPaperAction; },
      repair(identity) { identity.element.dataset.tangoPaperAction = 'quick-buy'; }
    },
    {
      label: 'changed action id',
      mutate(identity) { identity.element.dataset.tangoActionId = 'page-rewritten-action'; },
      repair(identity) { identity.element.dataset.tangoActionId = identity.actionId; }
    },
    {
      label: 'changed slot action id',
      mutate(identity) { identity.slot.dataset.tangoActionId = 'page-rewritten-action'; },
      repair(identity) { identity.slot.dataset.tangoActionId = identity.actionId; }
    },
    {
      label: 'changed binding nonce',
      mutate(identity) { identity.element.dataset.tangoBindingNonce = 'page-rewritten-nonce'; },
      repair(identity) { identity.element.dataset.tangoBindingNonce = identity.bindingNonce; }
    },
    {
      label: 'recycled binding',
      mutate(identity) { identity.slot.__tangoQuickBuyBinding = { ...identity.binding }; },
      repair(identity) { identity.slot.__tangoQuickBuyBinding = identity.binding; }
    },
    {
      label: 'recycled replacement identity',
      mutate(identity) { identity.binding.replacement = new loaded.FakeElement(); },
      repair(identity) { identity.binding.replacement = identity.element; }
    },
    {
      label: 'moved outside the slot',
      mutate(identity) { identity.slot.children.delete(identity.element); },
      repair(identity) { identity.slot.appendChild(identity.element); }
    },
    {
      label: 'changed binding state',
      mutate(identity) { identity.binding.state = 'page-rewritten-state'; },
      repair(identity) { identity.binding.state = identity.state; }
    }
  ];

  for (const [index, item] of cases.entries()) {
    const identity = paperIdentity(loaded, `paper-action-${index + 2}`);
    guard.registerPaperAction(identity.element, identity, identity.activate);
    assertBlocked(
      loaded.dispatch('click', [identity.element, identity.slot]),
      `${item.label}: registered identity`
    );

    item.mutate(identity);
    assertBlocked(
      loaded.dispatch('click', [identity.element, identity.slot]),
      `${item.label}: drifted identity`
    );

    item.repair(identity);
    assertBlocked(
      loaded.dispatch('click', [identity.element, identity.slot]),
      `${item.label}: page-only repair cannot restore trust`
    );

    guard.registerPaperAction(identity.element, identity, identity.activate);
    assertBlocked(
      loaded.dispatch('click', [identity.element, identity.slot]),
      `${item.label}: extension re-registration`
    );
    guard.revokePaperAction(identity.element);
    assertBlocked(
      loaded.dispatch('click', [identity.element, identity.slot]),
      `${item.label}: explicit revocation`
    );
  }
});

test('ancestor-only React remount self-heals while exact core drift remains fail-closed', () => {
  const loaded = loadGuard(new Promise(() => {}));
  const guard = loaded.context.Tango.NativeQuickBuyGuard;
  const identity = paperIdentity(loaded, 'paper-react-remount', {
    bindingNonce: 'nonce-1', generation: 1, state: 'ready'
  });
  const rootA = new loaded.FakeElement(['[data-sentry-component="BuyButtons"]']);
  const rootB = new loaded.FakeElement(['[data-sentry-component="BuyButtons"]']);
  rootA.appendChild(identity.card);
  assert.equal(guard.registerPaperAction(identity.element, identity, identity.activate), true);

  rootA.removeChild(identity.card);
  rootB.appendChild(identity.card);
  assertBlocked(loaded.dispatch('click', [
    identity.element, identity.slot, identity.card, rootB
  ]));
  assert.equal(guard.isPaperActionTrusted(identity.element, identity), true);
  const { element: ignoredElement, ...identityOptions } = identity;
  assert.equal(guard.isPaperActionTrusted(identity.element, identityOptions), true);

  identity.element.dataset.tangoBindingNonce = 'page-spoof';
  assertBlocked(loaded.dispatch('click', [
    identity.element, identity.slot, identity.card, rootB
  ]));
  identity.element.dataset.tangoBindingNonce = identity.bindingNonce;
  assert.equal(guard.isPaperActionTrusted(identity.element, identity), false);
});

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

test('trusted click rechecks the live slot card path and opaque adapter identity', () => {
  const loaded = loadGuard(new Promise(() => {}));
  const guard = loaded.context.Tango.NativeQuickBuyGuard;
  const cases = [
    {
      label: 'slot class removed',
      mutate(identity) { identity.slot.selectors.delete('.BuyButton-continer'); }
    },
    {
      label: 'slot moved to a different card',
      mutate(identity) {
        const otherCard = new loaded.FakeElement(['[class~="group/a"]']);
        otherCard.appendChild(identity.slot);
      }
    },
    {
      label: 'adapter route identity revoked',
      patch: { validate: () => false },
      mutate() {}
    }
  ];
  cases.forEach((item, index) => {
    let activations = 0;
    const identity = paperIdentity(loaded, `live-recheck-${index}`, {
      ...item.patch,
      activate: () => { activations += 1; }
    });
    assert.equal(guard.registerPaperAction(identity.element, identity, identity.activate), true);
    item.mutate(identity);

    assertBlocked(loaded.dispatch('click', [identity.element, identity.slot, identity.card], {
      isTrusted: true, button: 0, detail: 1
    }), item.label);
    assert.equal(activations, 0, item.label);
    assert.equal(guard.isPaperActionTrusted(identity.element, identity), false, item.label);
  });
});

test('isolated native guard treats missing malformed and failed settings reads as enabled', async () => {
  for (const readResult of [
    Promise.resolve({}),
    Promise.resolve({ [SETTINGS_KEY]: { enabled: 0 } }),
    Promise.reject(new Error('storage unavailable'))
  ]) {
    const loaded = loadGuard(readResult);
    await Promise.resolve();
    await Promise.resolve();
    const nativeRoot = new loaded.FakeElement(['[data-sentry-component="BuyButtons"]']);
    assertBlocked(loaded.dispatch('keydown', [nativeRoot], { key: 'Enter' }));
  }
});

test('GMGN adapter cannot authorize a paper action without the complete cross-world identity', () => {
  const loaded = loadGuard(new Promise(() => {}));
  vm.runInNewContext(adapterSource, loaded.context, { filename: 'src/adapters/gmgn.js' });
  const replacement = new loaded.FakeElement();
  Object.assign(replacement, {
    className: '', dataset: {}, style: { cssText: '' },
    getAttributeNames: () => [], getAttribute: () => ''
  });
  const profile = loaded.context.Tango.GMGN._applyLockedQuickBuyPresentation(replacement);
  assert.equal(profile.id, 'giant');
  assert.equal(profile.heightPx, 36);
  assert.equal(replacement.className, 'tango-list-quick-buy');
  assert.equal(replacement.style.cssText, '');
  assert.equal(replacement.dataset.tangoQuickBuySize, 'giant');
  const nativeSlot = new loaded.FakeElement(['.BuyButton-continer']);
  assertBlocked(
    loaded.dispatch('click', [replacement, nativeSlot]),
    'presentation setup alone must not register a paper action'
  );

  const actionId = 'adapter-paper-action';
  const binding = { replacement, actionId, pendingOnly: false };
  Object.assign(replacement.dataset, { tangoPaperAction: 'quick-buy', tangoActionId: actionId });
  Object.assign(nativeSlot.dataset, { tangoQuickBuy: '1', tangoActionId: actionId });
  nativeSlot.__tangoQuickBuyBinding = binding;
  nativeSlot.__tangoReplacementQuickBuy = replacement;
  nativeSlot.appendChild(replacement);
  loaded.context.Tango.GMGN._registerPaperQuickBuy(nativeSlot, binding);
  assertBlocked(loaded.dispatch('click', [replacement, nativeSlot]));

  const spoofedReplacement = new loaded.FakeElement(['[data-tango-paper-action="quick-buy"]']);
  assertBlocked(loaded.dispatch('click', [spoofedReplacement, nativeSlot]));
});
