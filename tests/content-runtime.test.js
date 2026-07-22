const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');

global.Tango = {};
const Chains = require('../src/core/chains.js');
const Supply = require('../src/core/supply.js');
delete global.Tango.Supply;
require('../src/shared/constants.js');
const RealState = require('../src/core/state.js');
const RealEngine = require('../src/core/engine.js');
const StateCoordinator = require('../src/core/state-coordinator.js');
const GMGNQuotes = require('../src/adapters/gmgn-quotes.js');
const RealGMGN = require('../src/adapters/gmgn.js');
const contentSource = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
const START = "  start().catch((error) => console.error('[Tango Paper Trader]', error));";
const EXPOSE = `  global.__contentTest = {
    runtime, start, performRefresh, refresh, performQuoteTick, handleRouteChange, handleQuickBuy, buy, sell, sellPosition, sellBreakeven,
    ensureTokenQuote, ensureNativePrice, freshNativePrice, rememberNativePrice,
    resolvePaperTradeQuote, positionCalibrationUpgrade, queueImmediateCurrentCalibration, paperExecutableQuote,
    requireExecutableQuote, freshExecutableQuote, renderPanel, renderBar, renderDrawer, requestCloseAll,
    commitCloseAll, savePresetEdits, bindEvents, bindDraggable, render, renderHeaderAccountSummary,
    detailRouteToken, routeTokenPlaceholder, ensureRouteTokenContext, acceptedTokenObservation, renderPnlCalendar,
    dispatchPageMessage: (data) => handlePageMessage({ source: window, data })
  };`;
const instrumentedSource = contentSource.replace(START, EXPOSE);

const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';
const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function defaultState() {
  return {
    initialized: true,
    accounts: {
      eth: { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 0 },
      base: { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 0 },
      sol: { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 0 },
      bsc: { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 0 },
      robinhood: { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 0 },
      xlayer: { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 0 }
    },
    positions: {}, trades: [], dailyRealizedByChain: { eth: {}, base: {} }
  };
}

function defaultSettings() {
  const chain = { buyPresets: [1], networkFeeNative: 0 };
  return {
    enabled: true, showListQuickBuy: true, language: 'en', displayCurrency: 'NATIVE', fastMode: false,
    selectedChain: 'eth',
    confirmationEnabled: true, platformFeeBps: 0, slippageBps: 0, soundEnabled: false,
    barCollapsed: false, panelCollapsed: false, panelPosition: null,
    chains: Object.fromEntries(Chains.all().map(({ id }) => [id, { ...chain }])), sellPresets: [100]
  };
}

function mutationQuickBuyHarness(address = ADDRESS_A) {
  let currentAddress = address;
  let replacement = null;
  const classes = new Set();
  const column = {
    isConnected: true,
    textContent: 'new creation\n',
    contains: (node) => node === card,
    querySelector(selector) {
      if (selector === '[class~="group/a"]') return card;
      return null;
    },
    querySelectorAll(selector) { return selector === '.BuyButton-continer' ? [slot] : []; }
  };
  const card = {
    nodeType: 1,
    isConnected: true,
    parentElement: column,
    get innerText() { return `${currentAddress}\nTOKEN Token Name\nMC\n$10K`; },
    get textContent() { return this.innerText; },
    getAttribute(name) {
      return name === 'href' ? `https://gmgn.ai/base/token/${currentAddress}` : null;
    },
    matches: () => false,
    closest(selector) {
      if (selector === '[class~="group/a"]') return card;
      if (selector === '[data-sentry-component="TrenchColumn"]') return column;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [slot];
      return [];
    },
    firstElementChild: { querySelector: () => null }
  };
  const identityNode = {
    nodeType: 1,
    tagName: 'A',
    parentElement: card,
    matches: () => false,
    closest(selector) {
      if (selector === '[class~="group/a"]') return card;
      if (selector === '[data-sentry-component="TrenchColumn"]') return column;
      return null;
    },
    querySelectorAll: () => []
  };
  const identityText = { nodeType: 3, parentElement: identityNode };
  const nativeControl = {
    isConnected: true,
    restored: 0,
    textContent: '0.1 ETH',
    getBoundingClientRect: () => ({ height: 24, width: 80 }),
    replaceWith(node) { this.isConnected = false; node.isConnected = true; replacement = node; },
    remove() { this.isConnected = false; }
  };
  const slot = {
    nodeType: 1,
    isConnected: true,
    parentElement: card,
    dataset: {},
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
    },
    matches: (selector) => selector === '.BuyButton-continer',
    closest(selector) {
      if (selector === '.BuyButton-continer') return slot;
      if (selector === '[class~="group/a"]') return card;
      if (selector === '[data-sentry-component="TrenchColumn"]') return column;
      return null;
    },
    getBoundingClientRect: () => ({ height: 24, width: 80 }),
    appendChild(node) { node.isConnected = true; replacement = node; return node; },
    querySelector(selector) {
      if (selector === '.tango-list-quick-buy') return replacement?.isConnected ? replacement : null;
      if (selector === '[data-testid="quickbuy"]') return nativeControl.isConnected ? nativeControl : null;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.tango-list-quick-buy' && replacement?.isConnected ? [replacement] : [];
    }
  };
  const makeElement = () => ({
    dataset: {}, style: {}, className: '', disabled: false, isConnected: false,
    setAttribute() {}, append() {},
    remove() { this.isConnected = false; },
    replaceWith(node) {
      this.isConnected = false;
      if (node === nativeControl) nativeControl.restored += 1;
      node.isConnected = true;
      replacement = node === nativeControl ? null : node;
    }
  });
  const document = {
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.BuyButton-continer') return [slot];
      if (selector === '.tango-native-buy-overridden') return classes.has('tango-native-buy-overridden') ? [slot] : [];
      if (selector === '.tango-list-quick-buy') return replacement?.isConnected ? [replacement] : [];
      return [];
    },
    createElement: makeElement
  };
  return {
    card, column, document, identityNode, identityText, nativeControl, slot,
    setAddress(next) { currentAddress = next; },
    get replacement() { return replacement; },
    get paperControlCount() { return replacement?.isConnected ? 1 : 0; }
  };
}

test('Engine fallback without Supply accepts only contextually valid explicit trusted sources', () => {
  assert.equal(global.Tango.Supply, undefined);
  const settings = RealState.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0,
    chains: { base: { networkFeeNative: 0 }, sol: { networkFeeNative: 0 } }
  });
  const base = { chain: 'base', address: ADDRESS_A, symbol: 'BASE' };
  const pump = {
    chain: 'sol', address: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP', symbol: 'PUMP'
  };
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 200_000, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const cases = [
    {
      name: 'exact', token: base,
      quote: { ...marketCapQuote, totalSupply: 100_000_000_000, supplySource: 'GMGN_EXACT' },
      expectedSource: 'GMGN_EXACT', expectedSupply: 100_000_000_000
    },
    {
      name: 'ratio', token: base,
      quote: {
        ...marketCapQuote, priceUsd: 0.000002,
        totalSupply: 100_000_000_000, supplySource: 'GMGN_RATIO',
        valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
      },
      expectedSource: 'GMGN_RATIO', expectedSupply: 100_000_000_000
    },
    {
      name: 'launchpad rule', token: {
        ...base, launchpad: 'Clanker', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
      },
      quote: { ...marketCapQuote, totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE' },
      expectedSource: 'LAUNCHPAD_RULE', expectedSupply: 100_000_000_000
    },
    {
      name: 'legacy Pump rule', token: pump,
      quote: {
        ...marketCapQuote, marketCapUsd: 4_000, nativePriceUsd: 100,
        totalSupply: 1_000_000_000, supplySource: 'LEGACY_PUMP_RULE',
        source: 'GMGN_TRENCH_MC', marketCapDivisor: 1_000_000_000
      },
      expectedSource: 'LEGACY_PUMP_RULE', expectedSupply: 1_000_000_000
    }
  ];

  for (const item of cases) {
    const initial = RealState.createInitialState({ now: 1 });
    initial.initialized = true;
    const result = RealEngine.executeBuy(initial, {
      token: item.token, quote: item.quote, amountNative: 1
    }, settings, 1_000);
    assert.equal(result.position.supplySource, item.expectedSource, item.name);
    assert.equal(result.position.totalSupply, item.expectedSupply, item.name);
  }
});

test('Engine fallback without Supply rejects unknown direct supply provenance', () => {
  assert.equal(global.Tango.Supply, undefined);
  const initial = RealState.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { base: { networkFeeNative: 0 } }
  });
  assert.throws(() => RealEngine.executeBuy(initial, {
    token: { chain: 'base', address: ADDRESS_A },
    quote: {
      priceUsd: 0, marketCapUsd: 200_000, nativePriceUsd: 2_000,
      totalSupply: 100_000_000_000, supplySource: 'CALLER_UNKNOWN',
      observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
    },
    amountNative: 1
  }, settings, 1_000), /invalidQuote/);
});

function mergeSettingsPatch(settings, patch) {
  const chains = { ...settings.chains };
  Object.entries(patch.chains || {}).forEach(([chainId, chainPatch]) => {
    chains[chainId] = { ...chains[chainId], ...chainPatch };
  });
  return { ...settings, ...patch, chains };
}

function loadContent({
  href = `https://gmgn.ai/eth/token/${ADDRESS_A}`, getAll, readCurrentToken, readTrenchSnapshot, sendMessage, patchSettings,
  updatePositionQuote,
  requestAnimationFrame = () => 0, timer = setTimeout,
  MutationObserver = class { observe() {} }
} = {}) {
  assert.notEqual(instrumentedSource, contentSource, 'content test harness must replace startup with runtime exports');
  const messages = [];
  const pageMessages = [];
  const calls = {
    buy: 0, buyOrders: [], sell: 0, sellOrders: [], metadataBatches: [],
    closeAll: 0, closeAllOrders: [], patches: [], fullSaves: [], getAll: 0, chainUsdSummaries: [],
    updatePositionQuotes: [], readCurrentToken: 0, discoverTokenCards: 0, clearQuickBuy: 0, storeSubscriber: null
  };
  const clock = { now: 1_000_000 };
  class FakeDate extends Date {
    constructor(...args) { super(args.length ? args[0] : clock.now); }
    static now() { return clock.now; }
  }
  const shellLists = new Map();
  const shell = {
    className: '', innerHTML: '',
    addEventListener() {}, querySelectorAll(selector) { return shellLists.get(selector) || []; }, querySelector() { return null; }
  };
  const shadowLists = new Map();
  const shadowSingles = new Map();
  const shadow = {
    append() {}, addEventListener() {},
    querySelectorAll(selector) { return shadowLists.get(selector) || []; },
    querySelector(selector) { return shadowSingles.get(selector) || null; }
  };
  const host = { id: '', attachShadow: () => shadow };
  const documentSingles = new Map();
  const genericElement = () => {
    const classes = new Set();
    const node = {
      className: '', id: '', rel: '', href: '', style: {}, dataset: {}, innerHTML: '', textContent: '',
      parentElement: null, children: [],
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        contains(name) { return classes.has(name); }
      },
      append(...children) { children.forEach((child) => node.appendChild(child)); },
      appendChild(child) {
        child.parentElement = node;
        node.children.push(child);
        if (child.id) documentSingles.set(`#${child.id}`, child);
        return child;
      },
      addEventListener() {},
      remove() {
        if (node.id) documentSingles.delete(`#${node.id}`);
        node.parentElement = null;
      },
      setAttribute(name, value) { node[name] = value; },
      querySelector() { return null; }, querySelectorAll() { return []; }
    };
    return node;
  };
  let createCount = 0;
  const document = {
    body: genericElement(), head: genericElement(),
    documentElement: { appendChild() {} },
    createElement() { createCount += 1; return createCount === 1 ? host : createCount === 3 ? shell : genericElement(); },
    querySelector(selector) { return documentSingles.get(selector) || null; },
    querySelectorAll() { return []; }, addEventListener() {}
  };
  const windowListeners = new Map();
  const context = {
    console,
    Date: FakeDate,
    URL,
    Map,
    WeakMap,
    Set,
    Math,
    Promise,
    document,
    location: { href, origin: 'https://gmgn.ai' },
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame,
    setTimeout: timer,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    postMessage(message) { pageMessages.push(message); },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type, listener) { if (windowListeners.get(type) === listener) windowListeners.delete(type); },
    MutationObserver,
    chrome: {
      runtime: {
        getURL: (value) => `chrome-extension://test/${value}`,
        sendMessage(message) {
          messages.push(message);
          return sendMessage ? sendMessage(message) : Promise.resolve({ ok: true });
        }
      }
    }
  };
  context.window = context;
  context.Tango = {
    QUOTE_STALE_MS: 15_000,
    Chains,
    GMGNQuotes,
    Supply,
    I18n: {
      resolveLanguage: () => 'en',
      t: (key, _language, vars) => key === 'closeAllFailedCount'
        ? `${vars?.count} failed tokens`
        : key
    },
    Format: {
      native: (value, symbol) => `${value} ${symbol}`, usd: (value) => `$${value}`, percent: String,
      compact: String, number: String, duration: String
    },
    ChainView: {
      positions: (state, chain) => Object.values(state?.positions || {}).filter((position) => position.chain === chain),
      trades: (state, chain) => (state?.trades || []).filter((trade) => trade.chain === chain),
      daily: (state, chain) => state?.dailyRealizedByChain?.[chain] || {}, closeOrders: () => []
    },
    Markers: { buildPayload: () => ({ markers: [] }) },
    Store: {
      getAll: async () => {
        calls.getAll += 1;
        return getAll ? getAll() : { state: defaultState(), settings: defaultSettings() };
      },
      async patchSettings(patch) {
        calls.patches.push(patch);
        if (patchSettings) return patchSettings(patch);
        return mergeSettingsPatch(context.__contentTest.runtime.settings, patch);
      },
      async saveSettings(settings) {
        calls.fullSaves.push(settings);
        throw new Error('content must use patchSettings');
      },
      async executeBuy(order) { return context.Tango.Engine.executeBuy(context.__contentTest.runtime.state, order); },
      async executeSell(order) { return context.Tango.Engine.executeSell(context.__contentTest.runtime.state, order); },
      async executeCloseAll(chain, orders) {
        calls.closeAll += 1;
        calls.closeAllOrders.push({ chain, orders });
        return { state: context.__contentTest.runtime.state, trades: orders.map(() => ({})), failures: [] };
      },
      async updatePositionQuote(token, quote) {
        calls.updatePositionQuotes.push({ token, quote });
        if (updatePositionQuote) return updatePositionQuote(token, quote, context.__contentTest.runtime.state);
        return context.__contentTest.runtime.state;
      },
      async updatePositionMetadata() { return defaultState(); },
      async updatePositionMetadataBatch(tokens) {
        calls.metadataBatches.push(tokens);
        return context.__contentTest.runtime.state;
      },
      subscribe(listener) { calls.storeSubscriber = listener; }
    },
    Engine: {
      positionKey: RealEngine.positionKey,
      validateQuote: RealEngine.validateQuote,
      updatePositionMetadata: (state) => state,
      updatePositionQuote: (state) => state,
      executeBuy(state, order) { calls.buy += 1; calls.buyOrders.push(order); return { state, trade: {} }; },
      executeSell(state, order) { calls.sell += 1; calls.sellOrders.push(order); return { state, trade: {} }; },
      executeCloseAll: (state) => ({ state, trades: [], failures: [] }),
      markPosition: RealEngine.markPosition,
      portfolioSummary: RealEngine.portfolioSummary,
      chainUsdSummary(state, chain, nativePriceUsd) {
        calls.chainUsdSummaries.push({ state, chain, nativePriceUsd });
        return RealEngine.chainUsdSummary(state, chain, nativePriceUsd);
      },
      breakevenSellPercent: () => null
    },
    GMGN: {
      clearQuickBuy() { calls.clearQuickBuy += 1; },
      discoverTokenCards: () => { calls.discoverTokenCards += 1; return 0; },
      readTrenchSnapshot: (chain, address) => readTrenchSnapshot ? readTrenchSnapshot(chain, address) : null,
      readVisibleTokenMetadata: () => [],
      readCurrentToken: async () => {
        calls.readCurrentToken += 1;
        return readCurrentToken ? readCurrentToken() : null;
      },
      resolveCurrentTokenRead(previous, next, url = context.location.href) {
        if (next) return next;
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const routeAddress = parts[1] === 'token' ? parts[2]?.toLowerCase() : '';
        return previous?.token && previous.token.chain === parts[0]
          && previous.token.address.toLowerCase() === routeAddress ? previous : null;
      },
      needsCurrentTokenRead: () => false
    }
  };
  vm.runInNewContext(instrumentedSource, context, { filename: 'src/content/content.js' });
  const api = context.__contentTest;
  api.runtime.state = defaultState();
  api.runtime.settings = defaultSettings();
  api.runtime.activeChainId = Chains.fromUrl(href)?.id || null;
  return {
    api, calls, clock, context, createDomNode: genericElement, documentSingles, messages, pageMessages,
    shadowLists, shadowSingles, shell, shellLists, windowListeners
  };
}

function setPresetInputs(loaded, {
  buy = [1, 2, 3, 4, 5, 6, 7, 8],
  sell = [5, 10, 15, 20, 25, 50, 75, 100]
} = {}) {
  loaded.shadowLists.set('[data-preset-side="buy"]', buy.map((value) => ({ value })));
  loaded.shadowLists.set('[data-preset-side="sell"]', sell.map((value) => ({ value })));
}

function eventElement({ dataset = {}, value = '' } = {}) {
  const listeners = new Map();
  return {
    dataset, value,
    addEventListener(type, listener) { listeners.set(type, listener); },
    emit(type, event) { return listeners.get(type)?.(event); }
  };
}

function quoteContext(address = ADDRESS_A) {
  return {
    token: { chain: 'eth', address, symbol: 'TEST' },
    quote: { priceUsd: 2, marketCapUsd: 2_000, source: 'GMGN', observedAt: 1_000_000 }
  };
}

test('a delayed quote tick cannot restore the old token after same-chain navigation', async () => {
  const gate = deferred();
  const oldContext = quoteContext();
  const loaded = loadContent({ readCurrentToken: () => gate.promise });
  const tick = loaded.api.performQuoteTick();
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  gate.resolve(oldContext);
  await tick;
  assert.notEqual(loaded.api.runtime.current, oldContext);
});

test('OFF-to-ON settings refresh restores the detail route content lifecycle once', async () => {
  const animationFrames = [];
  const enabledSettings = defaultSettings();
  const loaded = loadContent({
    getAll: () => ({ state: defaultState(), settings: enabledSettings }),
    readCurrentToken: async () => quoteContext(),
    requestAnimationFrame(callback) { animationFrames.push(callback); return animationFrames.length; }
  });
  loaded.api.runtime.settings = { ...loaded.api.runtime.settings, enabled: false };
  loaded.pageMessages.length = 0;

  async function flushRefresh() {
    await new Promise((resolve) => setImmediate(resolve));
    while (animationFrames.length) animationFrames.shift()();
    await Promise.resolve();
  }

  await loaded.api.performRefresh();
  await flushRefresh();

  assert.equal(loaded.api.runtime.settings.enabled, true);
  assert.ok(loaded.api.runtime.current?.token);
  assert.ok(loaded.calls.discoverTokenCards >= 1);
  assert.equal(loaded.calls.readCurrentToken, 1);
  assert.equal(loaded.pageMessages.filter((message) => message.type === 'REQUEST_QUOTES').length, 1);
  assert.notEqual(loaded.shell.innerHTML, '');

  await loaded.api.performRefresh();
  await flushRefresh();

  assert.equal(loaded.pageMessages.filter((message) => message.type === 'REQUEST_QUOTES').length, 1);
});

test('authoritative refresh reconciles an unchanged active GMGN route exactly once', async () => {
  const writeGate = deferred();
  const authoritativeSettings = { ...defaultSettings(), selectedChain: 'base' };
  const loaded = loadContent({
    href: `https://gmgn.ai/eth/token/${ADDRESS_A}`,
    getAll: () => ({ state: defaultState(), settings: authoritativeSettings }),
    patchSettings: () => writeGate.promise
  });
  Object.assign(loaded.api.runtime.selectedChainPersistence, {
    desiredChain: 'eth', persistedChain: 'eth', dirty: false, opportunity: 1
  });

  await loaded.api.performRefresh();

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'eth' }
  ]);
  assert.equal(loaded.api.runtime.selectedChainPersistence.persistedChain, 'base');

  writeGate.resolve({ ...authoritativeSettings, selectedChain: 'eth' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'eth' }
  ]);
  assert.equal(loaded.api.runtime.selectedChainPersistence.persistedChain, 'eth');
  assert.equal(loaded.api.runtime.settings.selectedChain, 'eth');
});

test('content preset edits patch only active-chain buys and global sells', async () => {
  const loaded = loadContent();
  loaded.api.runtime.presetEditing = 'all';
  setPresetInputs(loaded);

  await loaded.api.savePresetEdits();

  assert.equal(JSON.stringify(loaded.calls.patches), JSON.stringify([{
    chains: { eth: { buyPresets: [1, 2, 3, 4, 5, 6, 7, 8] } },
    sellPresets: [5, 10, 15, 20, 25, 50, 75, 100]
  }]));
  assert.deepEqual(loaded.calls.fullSaves, []);
  assert.deepEqual(Array.from(loaded.api.runtime.settings.chains.base.buyPresets), [1]);
});

test('content rejects a non-finite buy preset before patching', async () => {
  const loaded = loadContent();
  setPresetInputs(loaded, { buy: ['1e9999', 2, 3, 4, 5, 6, 7, 8] });

  await loaded.api.savePresetEdits();

  assert.equal(loaded.calls.patches.length, 0);
  assert.equal(loaded.api.runtime.toast.message, 'invalidPresets');
  assert.equal(loaded.api.runtime.toast.type, 'error');
});

test('content rejects a non-finite sell preset before patching', async () => {
  const loaded = loadContent();
  setPresetInputs(loaded, { sell: [5, 10, 15, 20, 25, 50, 75, '1e9999'] });

  await loaded.api.savePresetEdits();

  assert.equal(loaded.calls.patches.length, 0);
  assert.equal(loaded.api.runtime.toast.message, 'invalidPresets');
  assert.equal(loaded.api.runtime.toast.type, 'error');
});

test('content contains preset patch rejection and shows the settings error UI', async () => {
  const loaded = loadContent({ patchSettings: async () => { throw new Error('write failed'); } });
  setPresetInputs(loaded);

  const rejection = await loaded.api.savePresetEdits().then(() => null, (error) => error);

  assert.equal(rejection, null);
  assert.equal(loaded.api.runtime.toast.message, 'settingsSaveFailed');
  assert.equal(loaded.api.runtime.toast.type, 'error');
});

test('content preset click contains persistence rejection', async () => {
  const loaded = loadContent({ patchSettings: async () => { throw new Error('write failed'); } });
  const saveButton = eventElement({ dataset: { action: 'save-presets' } });
  loaded.shellLists.set('[data-action]', [saveButton]);
  setPresetInputs(loaded);
  loaded.api.bindEvents();

  const rejection = await saveButton.emit('click', { stopPropagation() {} }).then(() => null, (error) => error);

  assert.equal(rejection, null);
  assert.equal(loaded.api.runtime.toast.message, 'settingsSaveFailed');
});

test('content collapse and sound controls contain rejected settings writes and restore authoritative settings', async () => {
  for (const [action, field, authoritative] of [
    ['collapse-bar', 'barCollapsed', false],
    ['collapse-panel', 'panelCollapsed', false],
    ['toggle-sound', 'soundEnabled', false]
  ]) {
    const loaded = loadContent({ patchSettings: async () => { throw new Error('write failed'); } });
    const button = eventElement({ dataset: { action } });
    loaded.shellLists.set('[data-action]', [button]);
    loaded.api.bindEvents();

    const rejection = await button.emit('click', { stopPropagation() {} }).then(() => null, (error) => error);

    assert.equal(rejection, null, action);
    assert.equal(loaded.api.runtime.settings[field], authoritative, action);
    assert.equal(loaded.calls.getAll, 1, `${action} reloads authoritative settings`);
    assert.equal(loaded.api.runtime.toast.message, 'settingsSaveFailed');
    assert.equal(loaded.api.runtime.toast.type, 'error');
  }
});

test('content drag persistence rejection restores the authoritative position without escaping', async () => {
  const loaded = loadContent({ patchSettings: async () => { throw new Error('write failed'); } });
  const handle = eventElement();
  const element = eventElement();
  element.style = {};
  element.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 100 });
  element.removeEventListener = () => {};
  loaded.shadowSingles.set('[data-drag-handle]', handle);
  loaded.shadowSingles.set('.tango-panel', element);
  loaded.api.bindDraggable('[data-drag-handle]', '.tango-panel', 'panelPosition');

  handle.emit('pointerdown', {
    target: { closest: () => null },
    clientX: 10,
    clientY: 10
  });
  loaded.windowListeners.get('pointermove')({ clientX: 30, clientY: 40, preventDefault() {} });
  const rejection = await loaded.windowListeners.get('pointerup')().then(() => null, (error) => error);

  assert.equal(rejection, null);
  assert.equal(loaded.api.runtime.settings.panelPosition, null);
  assert.equal(loaded.calls.getAll, 1);
  assert.equal(loaded.api.runtime.toast.message, 'settingsSaveFailed');
});

test('content USD aggregate and position renders use canonical token USD marks', () => {
  const loaded = loadContent();
  const position = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', name: 'Test Token',
    quantity: 1, costBasisNative: 1, lastPriceUsd: 100, lastNativePriceUsd: 100,
    openedAt: loaded.clock.now - 1_000
  };
  loaded.api.runtime.state.accounts.eth = {
    initialBalanceNative: 10, cashBalanceNative: 9, realizedPnlNative: 0
  };
  loaded.api.runtime.state.positions = { [`eth:${ADDRESS_A}`]: position };
  loaded.api.runtime.settings.displayCurrency = 'USD';
  loaded.api.runtime.nativePrices.set('eth', 200);
  loaded.api.runtime.drawerOpen = true;
  const summary = loaded.context.Tango.Engine.portfolioSummary(loaded.api.runtime.state, 'eth');
  const usdSummary = loaded.context.Tango.Engine.chainUsdSummary(loaded.api.runtime.state, 'eth', 200);
  loaded.calls.chainUsdSummaries.length = 0;

  const bar = loaded.api.renderBar(summary);
  assert.equal(loaded.calls.chainUsdSummaries.length, 1, 'renderBar invokes the canonical USD helper once');
  assert.equal(loaded.calls.chainUsdSummaries[0].state, loaded.api.runtime.state);
  assert.equal(loaded.calls.chainUsdSummaries[0].chain, 'eth');
  assert.equal(loaded.calls.chainUsdSummaries[0].nativePriceUsd, 200);
  const drawer = loaded.api.renderDrawer(summary);
  loaded.api.requestCloseAll();

  assert.equal(usdSummary.assetsUsd, 1_900);
  assert.equal(usdSummary.pnlUsd, -100);
  assert.match(bar, /-\$100/);
  assert.doesNotMatch(bar, /\$1900|\$2000|\$0/);
  assert.equal((drawer.match(/\$100/g) || []).length >= 2, true, 'drawer total and row value use the token USD mark');
  assert.doesNotMatch(drawer, /value[^<]*\$200/);
  assert.equal(loaded.api.runtime.modal.rows[1][1], '$100');
});

test('content native aggregate and position renders remain native-denominated', () => {
  const loaded = loadContent();
  const position = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', name: 'Test Token',
    quantity: 1, costBasisNative: 1, lastPriceUsd: 100, lastNativePriceUsd: 100,
    openedAt: loaded.clock.now - 1_000
  };
  loaded.api.runtime.state.accounts.eth = {
    initialBalanceNative: 10, cashBalanceNative: 9, realizedPnlNative: 0
  };
  loaded.api.runtime.state.positions = { [`eth:${ADDRESS_A}`]: position };
  loaded.api.runtime.settings.displayCurrency = 'NATIVE';
  loaded.api.runtime.nativePrices.set('eth', 200);
  loaded.api.runtime.drawerOpen = true;
  const summary = loaded.context.Tango.Engine.portfolioSummary(loaded.api.runtime.state, 'eth', 200);

  const bar = loaded.api.renderBar(summary);
  const drawer = loaded.api.renderDrawer(summary);
  loaded.api.requestCloseAll();

  assert.match(bar, /-0\.5 ETH/);
  assert.doesNotMatch(bar, /\$/);
  assert.match(drawer, /positionTotal[\s\S]*0\.5 ETH/);
  assert.match(drawer, /value[^<]*0\.5 ETH/);
  assert.equal(loaded.api.runtime.modal.rows[1][1], '0.5 ETH');
});

test('content render forwards the current native price to native summary and row marks', () => {
  const loaded = loadContent();
  loaded.api.runtime.state.accounts.eth = {
    initialBalanceNative: 10, cashBalanceNative: 9, realizedPnlNative: 0
  };
  loaded.api.runtime.state.positions = {
    [`eth:${ADDRESS_A}`]: {
      chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', name: 'Test Token',
      quantity: 1, costBasisNative: 1, lastPriceUsd: 100, lastNativePriceUsd: 100,
      openedAt: loaded.clock.now - 1_000
    }
  };
  loaded.api.runtime.nativePrices.set('eth', 200);
  loaded.api.runtime.drawerOpen = true;

  loaded.api.render();

  assert.match(loaded.shell.innerHTML, /positionTotal[\s\S]*0\.5 ETH/);
  assert.match(loaded.shell.innerHTML, /value[^<]*0\.5 ETH/);
  assert.match(loaded.shell.innerHTML, /-0\.5 ETH/);
});

test('content USD position values use token marks before a native USD quote arrives', () => {
  const loaded = loadContent();
  loaded.api.runtime.state.positions = {
    [`eth:${ADDRESS_A}`]: {
      chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', name: 'Test Token',
      quantity: 1, costBasisNative: 1, lastPriceUsd: 100, openedAt: loaded.clock.now - 1_000
    }
  };
  loaded.api.runtime.settings.displayCurrency = 'USD';
  loaded.api.runtime.drawerOpen = true;
  const summary = loaded.context.Tango.Engine.portfolioSummary(loaded.api.runtime.state, 'eth');

  const drawer = loaded.api.renderDrawer(summary);
  loaded.api.requestCloseAll();

  assert.match(drawer, /positionTotal[\s\S]*\$100/);
  assert.match(drawer, /value[^<]*\$100/);
  assert.equal(loaded.api.runtime.modal.rows[1][1], '$100');
});

test('content preset Enter handler returns the contained save promise', async () => {
  const loaded = loadContent();
  const editor = eventElement();
  loaded.shellLists.set('.tango-preset-editor', [editor]);
  setPresetInputs(loaded);
  loaded.api.bindEvents();

  const saving = editor.emit('keydown', { key: 'Enter' });

  assert.equal(typeof saving?.then, 'function');
  await saving;
  assert.equal(loaded.calls.patches.length, 1);
});

test('panel trade totals keep Solana address identity case-sensitive', () => {
  const address = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
  const loaded = loadContent({ href: `https://gmgn.ai/sol/token/${address}` });
  loaded.api.runtime.current = {
    token: { chain: 'sol', address, symbol: 'TEST' },
    quote: {
      priceUsd: 2, marketCapUsd: 2_000, nativePriceUsd: 100,
      source: 'GMGN', observedAt: loaded.clock.now
    }
  };
  loaded.api.runtime.state.trades = [
    { chain: 'sol', tokenAddress: address, side: 'BUY', amountNative: 2 },
    { chain: 'sol', tokenAddress: address.toLowerCase(), side: 'BUY', amountNative: 9 }
  ];
  assert.match(loaded.api.renderPanel(), /<span>totalBuy<\/span><strong>2 SOL<\/strong>/);
});

test('quick buy with no market data commits immediately with a deterministic fallback quote', async () => {
  const never = deferred();
  const loaded = loadContent({
    sendMessage: (message) => /TANGO_GET_(TOKEN_QUOTE|NATIVE_PRICE)/.test(message.type)
      ? never.promise
      : Promise.resolve({ ok: true })
  });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  await loaded.api.handleQuickBuy({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'NEW', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
    quote: {}, amountNative: 1
  });
  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 3_200);
  assert.equal(loaded.calls.buyOrders[0].quote.totalSupply, 1_000_000_000);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceUsd, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.provisional, true);
  assert.equal(loaded.api.runtime.toast.type, 'success');
});

test('quick and detail buys resolve deterministic fallback valuations on every supported chain', async () => {
  const chains = [
    ['sol', SOL_ADDRESS], ['eth', ADDRESS_A], ['bsc', ADDRESS_A],
    ['base', ADDRESS_A], ['robinhood', ADDRESS_A], ['xlayer', ADDRESS_A]
  ];
  for (const [chain, address] of chains) {
    const loaded = loadContent({ href: `https://gmgn.ai/${chain}/token/${address}` });
    loaded.api.runtime.settings.fastMode = true;
    loaded.api.runtime.settings.confirmationEnabled = false;
    await loaded.api.handleQuickBuy({
      token: { chain, address, symbol: 'FALLBACK', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
      quote: {}, amountNative: 1
    });
    const order = loaded.calls.buyOrders[0];
    assert.equal(order.quote.priceUsd, 3_200 / 1_000_000_000, chain);
    assert.equal(order.quote.marketCapUsd, 3_200, chain);
    assert.equal(order.quote.totalSupply, 1_000_000_000, chain);
  }
});

test('local quick-buy feedback completes under 100 ms without timer advancement', async () => {
  const timerCallbacks = [];
  let timerAdvancements = 0;
  const loaded = loadContent({
    sendMessage: () => new Promise(() => {}),
    timer: (callback) => {
      timerCallbacks.push(() => { timerAdvancements += 1; return callback(); });
      return timerCallbacks.length;
    }
  });
  const state = RealState.createInitialState({ now: loaded.clock.now });
  state.initialized = true;
  const settings = RealState.normalizeSettings({
    ...defaultSettings(), fastMode: true, confirmationEnabled: false,
    chains: Object.fromEntries(Chains.all().map(({ id }) => [id, { buyPresets: [1], networkFeeNative: 0 }]))
  });
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(state),
    [global.Tango.SETTINGS_KEY]: structuredClone(settings)
  };
  const writes = [];
  const coordinator = StateCoordinator.create({
    async readRaw(keys) {
      await Promise.resolve();
      return Object.fromEntries(keys.filter((key) => key in values)
        .map((key) => [key, structuredClone(values[key])]));
    },
    async writeRaw(next) {
      await Promise.resolve();
      writes.push(structuredClone(next));
      Object.assign(values, structuredClone(next));
    },
    now: () => loaded.clock.now
  });
  loaded.context.Tango.Engine = RealEngine;
  loaded.context.Tango.Store.executeBuy = (order) => coordinator.mutate({ type: 'EXECUTE_BUY', order });
  loaded.api.runtime.state = state;
  loaded.api.runtime.settings = settings;
  const started = performance.now();
  await loaded.api.handleQuickBuy({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'FAST', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
    quote: {}, amountNative: 1
  });
  const elapsed = performance.now() - started;
  const committed = (await coordinator.getAll()).state;
  const position = committed.positions[RealEngine.positionKey('eth', ADDRESS_A)];
  assert.ok(position);
  assert.equal(committed.accounts.eth.cashBalanceNative, 9);
  assert.equal(committed.trades.length, 1);
  assert.equal(committed.stateRevision, 1);
  assert.equal(writes.length, 1);
  assert.equal(loaded.api.runtime.toast?.type, 'success');
  assert.ok(timerCallbacks.length > 0, 'fixture must observe scheduled background/toast timers');
  assert.equal(timerAdvancements, 0);
  assert.ok(elapsed < 100, `expected <100ms, got ${elapsed}ms`);
});

test('mutation observer batches targets, added nodes, and removed nodes into one incremental discovery', async () => {
  let observerCallback;
  const timers = [];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const loaded = loadContent({
    MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  const discoveries = [];
  loaded.context.Tango.GMGN.discoverTokenCards = (...args) => { discoveries.push(args[3]); return 0; };
  await loaded.api.start();
  discoveries.length = 0;
  const baselineTimerCount = timers.length;
  const targetA = { nodeType: 1 };
  const addedA = { nodeType: 1 };
  const removedA = { nodeType: 1 };
  const targetB = { nodeType: 1 };
  const bodyTarget = { nodeType: 1, tagName: 'BODY' };
  const addedFromBody = { nodeType: 1 };
  observerCallback([{ target: targetA, addedNodes: [addedA], removedNodes: [removedA] }]);
  observerCallback([{ target: targetB, addedNodes: [] }]);
  observerCallback([{ target: bodyTarget, addedNodes: [addedFromBody] }]);
  assert.equal(timers.length, baselineTimerCount + 1);
  assert.equal(discoveries.length, 0);
  timers[baselineTimerCount]();
  assert.equal(discoveries.length, 1);
  assert.deepEqual(Array.from(discoveries[0]), [targetA, addedA, removedA, targetB, addedFromBody]);
  assert.equal(loaded.api.runtime.pendingMutationRoots.size, 0);
});

test('content mutations promote changed card descendants into real GMGN live-slot reconciliation', async () => {
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver
  };
  let observerCallback;
  let observerOptions;
  const timers = [];
  const observed = [];
  const unobserved = [];
  let disconnects = 0;
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe(_target, options) { observerOptions = options; }
  }
  class CapturingResizeObserver {
    observe(slot) { observed.push(slot); }
    unobserve(slot) { unobserved.push(slot); }
    disconnect() { disconnects += 1; }
  }
  const harness = mutationQuickBuyHarness();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.ResizeObserver = CapturingResizeObserver;
  loaded.context.Tango.GMGN.discoverTokenCards = (...args) => RealGMGN.discoverTokenCards(...args);
  const flushMutation = (records) => {
    const timerIndex = timers.length;
    observerCallback(records);
    assert.equal(timers.length, timerIndex + 1);
    timers[timerIndex]();
  };
  try {
    await loaded.api.start();
    flushMutation([{
      type: 'childList', target: { nodeType: 1, tagName: 'BODY' }, addedNodes: [harness.card]
    }]);
    const firstControl = harness.replacement;
    const firstActionId = harness.slot.dataset.tangoActionId;
    const firstHandler = harness.slot.__tangoQuickBuyHandler;
    assert.equal(harness.slot.dataset.tangoTokenAddress, ADDRESS_A);

    harness.setAddress(ADDRESS_B);
    flushMutation([
      { type: 'attributes', target: harness.identityNode, attributeName: 'href' },
      { type: 'characterData', target: harness.identityText }
    ]);

    assert.equal(firstControl.isConnected, false);
    assert.notEqual(harness.slot.dataset.tangoActionId, firstActionId);
    assert.notEqual(harness.slot.__tangoQuickBuyHandler, firstHandler);
    assert.equal(harness.slot.dataset.tangoBindingKey, `base:${ADDRESS_B}`);
    assert.equal(harness.slot.dataset.tangoTokenAddress, ADDRESS_B);
    assert.equal(harness.paperControlCount, 1);
    assert.deepEqual(observed, [harness.slot, harness.slot]);
    assert.deepEqual(unobserved, [harness.slot]);
    assert.equal(disconnects, 1);
    assert.equal(harness.nativeControl.restored, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(observerOptions)), {
      childList: true, subtree: true, attributes: true, attributeFilter: ['href'], characterData: true
    });
  } finally {
    RealGMGN.clearQuickBuy();
    Object.assign(global, original);
  }
});

test('disabled quick-buy states clear once on transition and ignore repeated mutation batches', async () => {
  for (const disabledSettings of [
    { enabled: true, showListQuickBuy: false },
    { enabled: false, showListQuickBuy: false }
  ]) {
    let observerCallback;
    const timers = [];
    let settings = defaultSettings();
    class CapturingMutationObserver {
      constructor(callback) { observerCallback = callback; }
      observe() {}
    }
    const loaded = loadContent({
      href: 'https://gmgn.ai/?chain=base',
      getAll: () => ({ state: defaultState(), settings }),
      MutationObserver: CapturingMutationObserver,
      timer(callback) { timers.push(callback); return timers.length; }
    });
    await loaded.api.start();
    settings = { ...settings, ...disabledSettings };

    await loaded.api.performRefresh();

    assert.equal(loaded.calls.clearQuickBuy, 1, JSON.stringify(disabledSettings));
    for (let index = 0; index < 3; index += 1) {
      const timerIndex = timers.length;
      observerCallback([{ target: { nodeType: 1 }, addedNodes: [], removedNodes: [] }]);
      assert.equal(timers.length, timerIndex + 1);
      timers[timerIndex]();
    }
    assert.equal(loaded.calls.clearQuickBuy, 1, JSON.stringify(disabledSettings));
  }
});

test('market-cap-only quick buy derives price locally and never requests before commit', async () => {
  const loaded = loadContent();
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_A}`;
  loaded.api.handleRouteChange();
  await loaded.api.handleQuickBuy({
    token: { chain: 'base', address: ADDRESS_A, symbol: 'BANKR', launchpad: 'Clanker', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
    quote: { marketCapUsd: 200_000, observedAt: loaded.clock.now, source: 'GMGN_TRENCH' },
    amountNative: 1
  });
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 0.000002);
  assert.equal(loaded.calls.buyOrders[0].quote.totalSupply, 100_000_000_000);
});

test('position sell and close all use local position observations without quote waits', async () => {
  const loaded = loadContent({ sendMessage: () => new Promise(() => {}) });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  const positions = [ADDRESS_A, ADDRESS_B].map((address, index) => ({
    chain: 'eth', tokenAddress: address, symbol: `TOKEN${index + 1}`,
    quantity: 2, costBasisNative: 1, realizedPnlNative: 0,
    averageEntryPriceUsd: 2, lastPriceUsd: 2, lastMarketCapUsd: 2_000,
    lastNativePriceUsd: 3_000, quoteObservedAt: loaded.clock.now
  }));
  loaded.api.runtime.state.positions = Object.fromEntries(positions.map((position) => [
    `eth:${position.tokenAddress}`, position
  ]));
  loaded.context.Tango.ChainView.closeOrders = (state, chain, quoteFor) =>
    Object.values(state.positions).filter((position) => position.chain === chain).map((position) => ({
      token: { chain, address: position.tokenAddress, symbol: position.symbol },
      quote: quoteFor(position), percent: 100
    }));
  await loaded.api.sellPosition(positions[0], 50);
  await loaded.api.commitCloseAll();
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.closeAll, 1);
  assert.equal(loaded.calls.closeAllOrders[0].orders.length, 2);
  assert.equal(loaded.api.runtime.pendingTradeIntents, undefined);
});

test('passive native prices update every chain sharing the symbol without merging accounts', () => {
  const loaded = loadContent();
  const ethAccount = loaded.api.runtime.state.accounts.eth;
  const baseAccount = loaded.api.runtime.state.accounts.base;
  const robinhoodAccount = loaded.api.runtime.state.accounts.robinhood;
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES',
    prices: [{ symbol: 'ETH', priceUsd: 2_500, observedAt: loaded.clock.now - 10 }]
  });
  assert.equal(loaded.api.runtime.nativePrices.get('eth'), 2_500);
  assert.equal(loaded.api.runtime.nativePrices.get('base'), 2_500);
  assert.equal(loaded.api.runtime.nativePrices.get('robinhood'), 2_500);
  assert.equal(loaded.api.runtime.nativePrices.has('bsc'), false);
  assert.notEqual(ethAccount, baseAccount);
  assert.notEqual(baseAccount, robinhoodAccount);
});

test('an older native observation cannot replace a newer cached price', () => {
  const loaded = loadContent();
  loaded.api.rememberNativePrice('eth', 3_500, loaded.clock.now);
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now - 1_000);

  assert.equal(loaded.api.runtime.nativePrices.get('eth'), 3_500);
  assert.equal(loaded.api.runtime.nativePriceObservedAt.get('eth'), loaded.clock.now);
});

test('malformed and far-future native messages cannot poison the cached price', () => {
  const loaded = loadContent();
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES',
    prices: [{ symbol: 'ETH', priceUsd: 3_500, observedAt: loaded.clock.now }]
  });
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES', prices: [
      { symbol: 'ETH', priceUsd: Infinity, observedAt: loaded.clock.now + 1 },
      { symbol: 'ETH', priceUsd: 4_000, observedAt: Number.MAX_SAFE_INTEGER },
      { symbol: 'ETH', priceUsd: 4_500, observedAt: String(loaded.clock.now + 2) },
      { symbol: 'ETH', priceUsd: 'not-a-number', observedAt: loaded.clock.now + 3 }
    ]
  });

  assert.equal(loaded.api.runtime.nativePrices.get('eth'), 3_500);
  assert.equal(loaded.api.runtime.nativePriceObservedAt.get('eth'), loaded.clock.now);
  assert.equal(loaded.api.runtime.nativePrices.get('base'), 3_500);
  assert.equal(loaded.api.runtime.nativePriceObservedAt.get('base'), loaded.clock.now);
});

test('provisional copy is shown only for provisional panel and confirmation quotes', async () => {
  const provisional = loadContent();
  provisional.api.runtime.current = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'NEW', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
    quote: {}
  };
  await provisional.api.buy(1);
  assert.equal(provisional.api.runtime.modal.note, 'provisionalQuote');
  assert.match(provisional.api.renderPanel(), /provisionalQuote/);

  const observed = loadContent();
  observed.api.rememberNativePrice('eth', 3_000, observed.clock.now);
  observed.api.runtime.current = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'LIVE', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
    quote: { priceUsd: 2, observedAt: observed.clock.now, source: 'GMGN_NETWORK' }
  };
  await observed.api.buy(1);
  assert.equal(observed.api.runtime.modal.note, undefined);
  assert.doesNotMatch(observed.api.renderPanel(), /provisionalQuote/);
});

test('local paper quotes normalize the target and bind an identityless candidate', () => {
  const normalizedAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const mixedCaseAddress = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${normalizedAddress}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  const quote = loaded.api.resolvePaperTradeQuote(
    { chain: 'base', address: mixedCaseAddress, symbol: 'BOUND' },
    { priceUsd: 2, observedAt: loaded.clock.now, source: 'DEXSCREENER' }
  );
  assert.equal(quote.chain, 'base');
  assert.equal(quote.address, normalizedAddress);
  assert.equal(loaded.api.resolvePaperTradeQuote({ chain: 'eth', address: ADDRESS_A }, {}), null);
  assert.equal(loaded.api.resolvePaperTradeQuote({ chain: 'base', address: 'invalid' }, {}), null);
  assert.equal(loaded.api.paperExecutableQuote({ chain: 'base', address: 'invalid' }, quote), null);
});

test('local paper quotes discard an explicit cross-chain candidate identity', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  const quote = loaded.api.resolvePaperTradeQuote(
    { chain: 'base', address: ADDRESS_A, symbol: 'TARGET' },
    { chain: 'eth', address: ADDRESS_A, priceUsd: 2, observedAt: loaded.clock.now, source: 'DEXSCREENER' }
  );
  assert.equal(quote.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(quote.source, 'TANGO_FALLBACK');
  assert.equal(quote.provisional, true);
});

test('local paper quotes discard a same-chain candidate for another address', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  const quote = loaded.api.resolvePaperTradeQuote(
    { chain: 'base', address: ADDRESS_A, symbol: 'TARGET' },
    { chain: 'base', address: ADDRESS_B, priceUsd: 2, observedAt: loaded.clock.now, source: 'GMGN_NETWORK' }
  );
  assert.equal(quote.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(quote.source, 'TANGO_FALLBACK');
  assert.equal(quote.provisional, true);
});

test('paper resolver rejects contaminated live observations before falling back deterministically', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('eth', 2_000, loaded.clock.now);
  const token = { chain: 'eth', address: ADDRESS_A, symbol: 'TARGET' };
  const cases = [
    { chain: 'base', address: ADDRESS_A, priceUsd: 9, source: 'GMGN_NETWORK' },
    { chain: 'eth', address: ADDRESS_B, priceUsd: 9, source: 'GMGN_NETWORK' },
    { chain: 'eth', address: ADDRESS_A, priceUsd: 9, observedAt: loaded.clock.now - 15_001, source: 'GMGN_NETWORK' },
    { chain: 'eth', address: ADDRESS_A, priceUsd: 9, syntheticTokenPrice: true, source: 'GMGN_NETWORK' },
    { chain: 'eth', address: ADDRESS_A, priceUsd: Number.NaN, source: 'GMGN_NETWORK' },
    { chain: 'eth', address: ADDRESS_A, priceUsd: Infinity, source: 'GMGN_NETWORK' }
  ];
  for (const candidate of cases) {
    const quote = loaded.api.resolvePaperTradeQuote(token, { ...candidate, observedAt: candidate.observedAt ?? loaded.clock.now });
    assert.equal(quote.priceUsd, 3_200 / 1_000_000_000);
    assert.equal(quote.source, 'TANGO_FALLBACK');
  }
});

test('direct candidates cannot launder provisional or fallback prices as factual observations', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('eth', 2_000, loaded.clock.now);
  const token = { chain: 'eth', address: ADDRESS_A, symbol: 'TARGET' };
  const contaminated = [
    { source: 'GMGN_NETWORK', provisionalTokenPrice: true },
    { source: 'GMGN_NETWORK', priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP' }
  ];

  const contaminatedResults = contaminated.map((provenance) => {
    const quote = loaded.api.resolvePaperTradeQuote(token, {
      chain: 'eth', address: ADDRESS_A, priceUsd: 9,
      observedAt: loaded.clock.now, ...provenance
    });
    return { priceUsd: quote.priceUsd, source: quote.source, priceProvenance: quote.priceProvenance };
  });
  assert.deepEqual(JSON.parse(JSON.stringify(contaminatedResults)), contaminated.map(() => ({
    priceUsd: 3_200 / 1_000_000_000,
    source: 'TANGO_FALLBACK',
    priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP'
  })));

  for (const source of ['GMGN_NETWORK', 'DEXSCREENER']) {
    const quote = loaded.api.resolvePaperTradeQuote(token, {
      chain: 'eth', address: ADDRESS_A, priceUsd: 9,
      observedAt: loaded.clock.now, source, priceProvenance: 'OBSERVED_PRICE'
    });
    assert.equal(quote.priceUsd, 9, source);
    assert.equal(quote.source, source, source);
    assert.equal(quote.priceProvenance, 'OBSERVED_PRICE', source);
  }
});

test('page-message quote caching rejects untrusted and synthetic-derived observations', () => {
  const cases = [
    { source: 'PAGE_TEXT' },
    { source: 'TANGO_FALLBACK' },
    { source: 'GMGN_NETWORK', syntheticTokenPrice: true, priceProvenance: 'SYNTHETIC_PRICE' },
    { source: 'GMGN_NETWORK', priceProvenance: 'MARKET_CAP_DERIVED' }
  ];

  for (const poison of cases) {
    const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
    loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
    loaded.api.dispatchPageMessage({
      source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
        chain: 'base', address: ADDRESS_A, priceUsd: 9,
        observedAt: loaded.clock.now, ...poison
      }]
    });

    assert.equal(loaded.api.runtime.gmgnQuotes.size, 0, poison.source);
    const quote = loaded.api.resolvePaperTradeQuote(
      { chain: 'base', address: ADDRESS_A, symbol: 'TARGET' }, {}
    );
    assert.equal(quote.priceUsd, 3_200 / 1_000_000_000, poison.source);
    assert.equal(quote.source, 'TANGO_FALLBACK', poison.source);
  }
});

test('resolver refuses contaminated raw cache entries before they become authoritative', () => {
  const cases = [
    { source: 'PAGE_TEXT' },
    { source: 'TANGO_FALLBACK' },
    { source: 'GMGN_NETWORK', syntheticTokenPrice: true, priceProvenance: 'SYNTHETIC_PRICE' },
    { source: 'GMGN_NETWORK', priceProvenance: 'MARKET_CAP_DERIVED' }
  ];

  for (const poison of cases) {
    const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
    loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
    loaded.api.runtime.gmgnQuotes.set(`base:${ADDRESS_A}`, {
      chain: 'base', address: ADDRESS_A, priceUsd: 9,
      observedAt: loaded.clock.now, ...poison
    });

    const quote = loaded.api.resolvePaperTradeQuote(
      { chain: 'base', address: ADDRESS_A, symbol: 'TARGET' }, {}
    );
    assert.equal(quote.priceUsd, 3_200 / 1_000_000_000, poison.source);
    assert.equal(quote.source, 'TANGO_FALLBACK', poison.source);
  }
});

test('unverified launchpad labels cannot select a registry fallback valuation', () => {
  for (const launchpad of ['Clanker', 'Bankr']) {
    const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
    loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
    const quote = loaded.api.resolvePaperTradeQuote({
      chain: 'base', address: ADDRESS_A, symbol: 'UNVERIFIED', launchpad,
      metadataVerified: false, metadataSource: 'GMGN_TRENCH'
    }, {});

    assert.equal(quote.priceUsd, 3_200 / 1_000_000_000, launchpad);
    assert.equal(quote.marketCapUsd, 3_200, launchpad);
    assert.equal(quote.totalSupply, 1_000_000_000, launchpad);
    assert.equal(quote.supplySource, 'UNKNOWN_FALLBACK', launchpad);
    assert.equal(quote.valuationSource, 'UNKNOWN_INITIAL_MARKET_CAP', launchpad);
  }
});

test('candidate direct supply with unknown provenance cannot become GMGN exact through the resolver or Engine', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  const token = { chain: 'base', address: ADDRESS_A, symbol: 'UNKNOWN' };
  const quote = loaded.api.resolvePaperTradeQuote(token, {
    priceUsd: 2, totalSupply: 7, supplySource: 'CALLER_UNKNOWN',
    observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
  });
  assert.notEqual(quote.supplySource, 'GMGN_EXACT');
  assert.notEqual(quote.totalSupply, 7);
  assert.notEqual(quote.marketCapDivisor, 7);

  const initial = RealState.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { base: { networkFeeNative: 0 } }
  });
  const result = RealEngine.executeBuy(initial, { token, quote, amountNative: 1 }, settings, loaded.clock.now);
  assert.notEqual(result.position.totalSupply, 7);
  assert.notEqual(result.position.marketCapDivisor, 7);
});

test('resolver consumes a provisional 1B divisor without promoting it to trusted supply', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/bsc/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('bsc', 600, loaded.clock.now);
  const quote = loaded.api.resolvePaperTradeQuote(
    { chain: 'bsc', address: ADDRESS_A, symbol: 'PROVISIONAL' },
    {
      chain: 'bsc', address: ADDRESS_A, marketCapUsd: 5_000,
      provisionalSupply: 1_000_000_000, provisional: true, syntheticTokenPrice: true,
      observedAt: loaded.clock.now, source: 'GMGN_TRENCH'
    }
  );
  assert.equal(quote.priceUsd, 5_000 / 1_000_000_000);
  assert.equal(quote.syntheticTokenPrice, true);
  assert.equal(quote.provisional, true);
  assert.equal(quote.totalSupply, 1_000_000_000);
  assert.equal(quote.supplySource, 'UNKNOWN_FALLBACK');
});

test('cached exact supply wins over a provisional card candidate after cache merge', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.api.runtime.gmgnQuotes.set(`base:${ADDRESS_A}`, GMGNQuotes.mergeObservation(null, {
    chain: 'base', address: ADDRESS_A, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
    totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: loaded.clock.now - 1_000, source: 'GMGN_NETWORK'
  }));
  const quote = loaded.api.resolvePaperTradeQuote(
    { chain: 'base', address: ADDRESS_A, symbol: 'CACHED' },
    {
      chain: 'base', address: ADDRESS_A, marketCapUsd: 5_000,
      priceUsd: 5_000 / 1_000_000_000, provisionalSupply: 1_000_000_000,
      provisional: true, syntheticTokenPrice: true, observedAt: loaded.clock.now, source: 'GMGN_TRENCH'
    }
  );
  assert.equal(quote.priceUsd, 5_000 / 100_000_000_000);
  assert.equal(quote.totalSupply, 100_000_000_000);
  assert.equal(quote.supplySource, 'GMGN_EXACT');
  assert.equal(quote.syntheticTokenPrice, false);
  assert.equal(quote.provisionalSupply, 0);
  assert.equal(quote.provisional, false);
});

test('resolver preserves a launchpad rule for a market-cap-derived card price', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  const quote = loaded.api.resolvePaperTradeQuote(
    {
      chain: 'base', address: ADDRESS_A, symbol: 'CLANK', launchpad: 'Clanker',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    {
      chain: 'base', address: ADDRESS_A, marketCapUsd: 200_000,
      priceUsd: 200_000 / 100_000_000_000,
      totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
      priceProvenance: 'MARKET_CAP_DERIVED', observedAt: loaded.clock.now, source: 'GMGN_TRENCH'
    }
  );
  assert.equal(quote.priceUsd, 200_000 / 100_000_000_000);
  assert.equal(quote.totalSupply, 100_000_000_000);
  assert.equal(quote.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(quote.priceProvenance, 'MARKET_CAP_DERIVED');
});

test('resolver quotes preserve valid GMGN exact, ratio, and verified launchpad-rule supply', () => {
  const cases = [];

  const exactLoaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  exactLoaded.api.rememberNativePrice('base', 2_000, exactLoaded.clock.now);
  exactLoaded.api.runtime.gmgnQuotes.set(`base:${ADDRESS_A}`, GMGNQuotes.mergeObservation(null, {
    chain: 'base', address: ADDRESS_A, priceUsd: 2, totalSupply: 10_000,
    totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: exactLoaded.clock.now,
    source: 'GMGN_NETWORK'
  }));
  cases.push({
    name: 'exact', loaded: exactLoaded,
    token: { chain: 'base', address: ADDRESS_A, symbol: 'EXACT' }, candidate: {},
    source: 'GMGN_EXACT', supply: 10_000
  });

  const ratioLoaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  ratioLoaded.api.rememberNativePrice('base', 2_000, ratioLoaded.clock.now);
  cases.push({
    name: 'ratio', loaded: ratioLoaded,
    token: { chain: 'base', address: ADDRESS_A, symbol: 'RATIO' },
    candidate: { priceUsd: 2, marketCapUsd: 20_000, observedAt: ratioLoaded.clock.now, source: 'GMGN_NETWORK' },
    source: 'GMGN_RATIO', supply: 10_000
  });

  const ruleLoaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  ruleLoaded.api.rememberNativePrice('base', 2_000, ruleLoaded.clock.now);
  cases.push({
    name: 'rule', loaded: ruleLoaded,
    token: {
      chain: 'base', address: ADDRESS_A, symbol: 'RULE', launchpad: 'Clanker',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    candidate: { marketCapUsd: 200_000, observedAt: ruleLoaded.clock.now, source: 'GMGN_TRENCH' },
    source: 'LAUNCHPAD_RULE', supply: 100_000_000_000
  });

  for (const item of cases) {
    const quote = item.loaded.api.resolvePaperTradeQuote(item.token, item.candidate);
    assert.equal(quote.supplySource, item.source, item.name);
    assert.equal(quote.totalSupply, item.supply, item.name);
    const initial = RealState.createInitialState({ now: 1 });
    initial.initialized = true;
    const settings = RealState.normalizeSettings({
      slippageBps: 0, platformFeeBps: 0, chains: { base: { networkFeeNative: 0 } }
    });
    const result = RealEngine.executeBuy(
      initial, { token: item.token, quote, amountNative: 1 }, settings, item.loaded.clock.now
    );
    assert.equal(result.position.supplySource, item.source, item.name);
    assert.equal(result.position.totalSupply, item.supply, item.name);
  }
});

test('resolver does not promote a newer price and older market cap into a GMGN ratio', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.api.runtime.gmgnQuotes.set(`base:${ADDRESS_A}`, GMGNQuotes.mergeObservation(null, {
    chain: 'base', address: ADDRESS_A, marketCapUsd: 200_000,
    observedAt: loaded.clock.now - 1_000, source: 'GMGN_NETWORK'
  }));

  const quote = loaded.api.resolvePaperTradeQuote(
    {
      chain: 'base', address: ADDRESS_A, symbol: 'CLANK', launchpad: 'Clanker',
      metadataVerified: true, metadataSource: 'GMGN_NETWORK'
    },
    {
      chain: 'base', address: ADDRESS_A, priceUsd: 2,
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }
  );

  assert.equal(quote.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(quote.totalSupply, 100_000_000_000);
});

test('resolver excludes an old position cap from a new factual price ratio', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  const oldObservedAt = loaded.clock.now - 1_000;
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.api.runtime.state.positions[`base:${ADDRESS_A}`] = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'CLANK', name: 'Clank', quantity: 100,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 1,
    lastPriceUsd: 1, lastMarketCapUsd: 200_000, lastNativePriceUsd: 2_000,
    quoteObservedAt: oldObservedAt, valuationMode: 'PRICE',
    totalSupply: 100_000_000_000, marketCapDivisor: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE', launchpad: 'Clanker', openedAt: 1
  };

  const quote = loaded.api.resolvePaperTradeQuote(
    {
      chain: 'base', address: ADDRESS_A, symbol: 'CLANK', launchpad: 'Clanker',
      metadataVerified: true, metadataSource: 'GMGN_NETWORK'
    },
    {
      chain: 'base', address: ADDRESS_A, priceUsd: 2,
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }
  );

  assert.equal(quote.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(quote.totalSupply, 100_000_000_000);
});

test('position-only history cannot fabricate a GMGN ratio or trigger immediate calibration', () => {
  const key = `base:${ADDRESS_A}`;
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  const token = {
    chain: 'base', address: ADDRESS_A, symbol: 'CLANK', launchpad: 'Clanker',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  const position = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'CLANK', name: 'Clank', quantity: 100,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 1,
    lastPriceUsd: 1, lastMarketCapUsd: 200_000, lastNativePriceUsd: 2_000,
    quoteObservedAt: loaded.clock.now - 1, valuationMode: 'PRICE',
    totalSupply: 100_000_000_000, marketCapDivisor: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE', launchpad: 'Clanker',
    needsCalibration: true, provisional: false, openedAt: 1
  };
  loaded.api.runtime.current = { token, quote: {} };
  loaded.api.runtime.state.positions[key] = position;

  assert.equal(loaded.api.runtime.gmgnQuotes.size, 0);
  const quote = loaded.api.resolvePaperTradeQuote(token, {}, { position });
  const calibrationQueued = loaded.api.queueImmediateCurrentCalibration() !== null;

  assert.deepEqual({
    supplySource: quote.supplySource,
    totalSupply: quote.totalSupply,
    calibrationUpgrade: loaded.api.positionCalibrationUpgrade(position, quote),
    calibrationQueued,
    calibrationWrites: loaded.calls.updatePositionQuotes.length
  }, {
    supplySource: 'LAUNCHPAD_RULE',
    totalSupply: 100_000_000_000,
    calibrationUpgrade: false,
    calibrationQueued: false,
    calibrationWrites: 0
  });
});

test('a newer DEX price keeps an older exact GMGN supply and its field provenance', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.api.runtime.gmgnQuotes.set(`base:${ADDRESS_A}`, GMGNQuotes.mergeObservation(null, {
    chain: 'base', address: ADDRESS_A, priceUsd: 1, totalSupply: 10_000,
    totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: loaded.clock.now - 1_000,
    source: 'GMGN_NETWORK'
  }));

  const quote = loaded.api.resolvePaperTradeQuote(
    { chain: 'base', address: ADDRESS_A, symbol: 'MIXED' },
    { chain: 'base', address: ADDRESS_A, priceUsd: 2, observedAt: loaded.clock.now, source: 'DEXSCREENER' }
  );

  assert.equal(quote.priceUsd, 2);
  assert.equal(quote.source, 'DEXSCREENER');
  assert.equal(quote.priceSource, 'DEXSCREENER');
  assert.equal(quote.supplySource, 'GMGN_EXACT');
  assert.equal(quote.totalSupply, 10_000);
  assert.equal(quote.totalSupplyObservationSource, 'GMGN_NETWORK');
});

test('header native balance attaches to connected wallet or stable header-actions fallback', () => {
  for (const connected of [true, false]) {
    const loaded = loadContent();
    loaded.api.runtime.state.accounts.eth.cashBalanceNative = 7;
    loaded.api.runtime.state.accounts.bsc.cashBalanceNative = 99;
    const anchor = loaded.createDomNode();
    loaded.documentSingles.set(
      connected ? '[data-testid="wallet-connected"]' : '[data-testid="header-actions"]',
      anchor
    );

    loaded.api.renderHeaderAccountSummary({});

    const summary = loaded.documentSingles.get('#tango-header-account-summary');
    assert.ok(summary, connected ? 'connected wallet fixture' : 'disconnected header-actions fixture');
    assert.equal(summary.parentElement, anchor);
    assert.equal(anchor.classList.contains('tango-header-summary-anchor'), true);
    assert.match(summary.innerHTML, /7 ETH/);
    assert.doesNotMatch(summary.innerHTML, /99/);
  }
});

test('SPA chain change immediately renders the new chain native balance on a trench page', async () => {
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=eth',
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });
  loaded.api.runtime.state.accounts.eth.cashBalanceNative = 7;
  loaded.api.runtime.state.accounts.bsc.cashBalanceNative = 99;
  const anchor = loaded.createDomNode();
  loaded.documentSingles.set('[data-testid="header-actions"]', anchor);
  loaded.api.renderHeaderAccountSummary({});
  assert.match(loaded.documentSingles.get('#tango-header-account-summary').innerHTML, /7 ETH/);

  loaded.context.location.href = 'https://gmgn.ai/?chain=bsc';
  loaded.api.handleRouteChange();

  const summary = loaded.documentSingles.get('#tango-header-account-summary');
  assert.ok(summary, 'the route handler must replace the cleared header summary');
  assert.match(summary.innerHTML, /99 BNB/);
  assert.doesNotMatch(summary.innerHTML, /7 ETH/);
  await new Promise((resolve) => setImmediate(resolve));
});

test('startup persists the GMGN route chain as the extension selected chain', async () => {
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });

  await loaded.api.start();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [{ selectedChain: 'base' }]);
  assert.equal(loaded.api.runtime.settings.selectedChain, 'base');
});

test('route-chain persistence uses one worker and drains only the latest desired chain', async () => {
  const gates = [];
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=eth',
    patchSettings(patch) {
      const gate = deferred();
      gates.push({ chain: patch.selectedChain, gate });
      return gate.promise;
    }
  });

  loaded.context.location.href = 'https://gmgn.ai/?chain=base';
  loaded.api.handleRouteChange();
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_A}`;
  loaded.api.handleRouteChange();
  loaded.context.location.href = 'https://gmgn.ai/?chain=bsc';
  loaded.api.handleRouteChange();

  assert.deepEqual(gates.map(({ chain }) => chain), ['base']);

  gates[0].gate.resolve({ ...defaultSettings(), selectedChain: 'base' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(gates.map(({ chain }) => chain), ['base', 'bsc']);

  gates[1].gate.resolve({ ...defaultSettings(), selectedChain: 'bsc' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded.api.runtime.settings.selectedChain, 'bsc');
});

test('failed route-chain persistence stays dirty and retries on the next route opportunity', async () => {
  let attempt = 0;
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=eth',
    patchSettings: async (patch) => {
      attempt += 1;
      if (attempt === 1) throw new Error('write failed');
      return { ...defaultSettings(), ...patch };
    }
  });

  loaded.context.location.href = 'https://gmgn.ai/?chain=base';
  loaded.api.handleRouteChange();
  await new Promise((resolve) => setImmediate(resolve));
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_A}`;
  loaded.api.handleRouteChange();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(attempt, 2);
  assert.equal(loaded.api.runtime.settings.selectedChain, 'base');
});

test('a newer route opportunity drains after the older in-flight persistence fails', async () => {
  const baseGate = deferred();
  const bscGate = deferred();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=eth',
    patchSettings(patch) {
      return patch.selectedChain === 'base' ? baseGate.promise : bscGate.promise;
    }
  });

  loaded.context.location.href = 'https://gmgn.ai/?chain=base';
  loaded.api.handleRouteChange();
  loaded.context.location.href = 'https://gmgn.ai/?chain=bsc';
  loaded.api.handleRouteChange();
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'base' }
  ]);

  baseGate.reject(new Error('base write failed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'base' },
    { selectedChain: 'bsc' }
  ]);

  bscGate.resolve({ ...defaultSettings(), selectedChain: 'bsc' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded.api.runtime.settings.selectedChain, 'bsc');
});

test('SPA chain persistence serializes an earlier write before applying the latest route', async () => {
  const writes = new Map();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=eth',
    requestAnimationFrame: (callback) => { callback(); return 1; },
    patchSettings(patch) {
      const gate = deferred();
      writes.set(patch.selectedChain, gate);
      return gate.promise;
    }
  });

  loaded.context.location.href = 'https://gmgn.ai/?chain=base';
  loaded.api.handleRouteChange();
  loaded.context.location.href = 'https://gmgn.ai/?chain=bsc';
  loaded.api.handleRouteChange();

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'base' }
  ]);

  writes.get('base').resolve({ ...defaultSettings(), selectedChain: 'base' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'base' },
    { selectedChain: 'bsc' }
  ]);
  writes.get('bsc').resolve({ ...defaultSettings(), selectedChain: 'bsc' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.api.runtime.settings.selectedChain, 'bsc');
});

test('serialized GMGN chain persistence ends on the current chain after an away-and-back race', async () => {
  const baseGate = deferred();
  let persisted = defaultSettings();
  let queue = Promise.resolve();
  const writes = [];
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=eth',
    patchSettings(patch) {
      const write = queue.then(async () => {
        if (patch.selectedChain === 'base') await baseGate.promise;
        persisted = mergeSettingsPatch(persisted, patch);
        return persisted;
      });
      queue = write.catch(() => null);
      writes.push(write);
      return write;
    }
  });

  loaded.context.location.href = 'https://gmgn.ai/?chain=base';
  loaded.api.handleRouteChange();
  loaded.context.location.href = 'https://gmgn.ai/?chain=eth';
  loaded.api.handleRouteChange();

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'base' }
  ]);
  baseGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'base' },
    { selectedChain: 'eth' }
  ]);
  await Promise.all(writes);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(persisted.selectedChain, 'eth');
  assert.equal(loaded.api.runtime.settings.selectedChain, 'eth');
});

test('route chain reconciliation persists A after the URL returns A before its route handler runs', async () => {
  const baseGate = deferred();
  let persisted = defaultSettings();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=eth',
    patchSettings: async (patch) => {
      if (patch.selectedChain === 'base') await baseGate.promise;
      persisted = mergeSettingsPatch(persisted, patch);
      return persisted;
    }
  });

  loaded.context.location.href = 'https://gmgn.ai/?chain=base';
  loaded.api.handleRouteChange();
  loaded.context.location.href = 'https://gmgn.ai/?chain=eth';

  baseGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  loaded.api.handleRouteChange();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [
    { selectedChain: 'base' },
    { selectedChain: 'eth' }
  ]);
  assert.equal(persisted.selectedChain, 'eth');
});

test('every valid detail route renders a placeholder panel and buys at the deterministic fallback without chart or market data', async () => {
  for (const { id: chain } of Chains.all()) {
    const address = chain === 'sol' ? SOL_ADDRESS : ADDRESS_A;
    const loaded = loadContent({
      href: `https://gmgn.ai/${chain}/token/${address}`,
      readCurrentToken: async () => null,
      requestAnimationFrame: (callback) => { callback(); return 1; }
    });

    await loaded.api.start();
    loaded.api.runtime.settings.fastMode = true;
    loaded.api.runtime.settings.confirmationEnabled = false;

    assert.equal(loaded.api.runtime.current?.token.chain, chain, chain);
    assert.equal(loaded.api.runtime.current?.token.address, address, chain);
    assert.equal(loaded.api.runtime.current?.token.metadataVerified, false, chain);
    assert.match(loaded.api.renderPanel(), /tango-panel/, chain);
    await loaded.api.buy(1);
    assert.equal(loaded.calls.buy, 1, chain);
    assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 3_200, chain);
    loaded.api.runtime.state.positions[`${chain}:${address}`] = {
      chain, tokenAddress: address, symbol: 'HELD', name: 'Held Token', quantity: 1, costBasisNative: 1,
      lastPriceUsd: 3_200 / 1_000_000_000, lastMarketCapUsd: 3_200, lastNativePriceUsd: 1,
      quoteObservedAt: loaded.clock.now
    };
    await loaded.api.sell(100);
    assert.equal(loaded.calls.sell, 1, chain);
  }
});

test('detail placeholders reuse trench metadata only for the exact chain and normalized address, then accept exact GMGN upgrades', () => {
  const snapshot = {
    token: {
      chain: 'eth', address: ADDRESS_A, symbol: 'TRENCH', name: 'Trench Token', logoUrl: 'trench.png',
      launchpad: 'Clanker', launchMode: 'MIGRATED', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: { marketCapUsd: 9_100, source: 'GMGN_TRENCH', observedAt: 1_000_000 }
  };
  const loaded = loadContent({
    href: `https://gmgn.ai/eth/token/0x${ADDRESS_A.slice(2).toUpperCase()}`,
    readTrenchSnapshot: (chain, address) => chain === 'eth' && address === ADDRESS_A ? snapshot : null
  });

  const context = loaded.api.ensureRouteTokenContext();
  assert.deepEqual(JSON.parse(JSON.stringify(context)), snapshot);
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'eth', address: ADDRESS_B, symbol: 'WRONG', name: 'Wrong Token', logoUrl: 'wrong.png',
      priceUsd: 2, marketCapUsd: 2_000, observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }]
  });
  assert.equal(context.token.symbol, 'TRENCH');
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'eth', address: ADDRESS_A, symbol: 'LIVE', name: 'Live Token', logoUrl: 'live.png',
      priceUsd: 2, marketCapUsd: 2_000, observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(context.token)), {
    chain: 'eth', address: ADDRESS_A, symbol: 'LIVE', name: 'Live Token', logoUrl: 'live.png',
    launchpad: 'Clanker', launchMode: 'MIGRATED', metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  });
});

test('detail placeholders reject trench metadata from a different address or chain', () => {
  const snapshot = {
    token: {
      chain: 'eth', address: ADDRESS_A, symbol: 'WRONG', name: 'Wrong Token', logoUrl: 'wrong.png',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: { marketCapUsd: 9_100, source: 'GMGN_TRENCH', observedAt: 1_000_000 }
  };
  for (const href of [
    `https://gmgn.ai/eth/token/${ADDRESS_B}`,
    `https://gmgn.ai/base/token/${ADDRESS_A}`
  ]) {
    const loaded = loadContent({ href, readTrenchSnapshot: () => snapshot });
    const context = loaded.api.ensureRouteTokenContext();
    assert.notEqual(context.token.symbol, 'WRONG', href);
    assert.equal(context.quote.marketCapUsd || 0, 0, href);
  }
});

test('detail placeholder metadata falls back from an exact position to an exact trade before the route label', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'POSITION', name: 'Position Token', logoUrl: 'position.png',
    launchpad: 'Clanker', launchMode: 'MIGRATED', metadataSource: 'GMGN_TRENCH'
  };
  assert.equal(loaded.api.routeTokenPlaceholder().token.symbol, 'POSITION');
  delete loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`];
  loaded.api.runtime.state.trades.push({
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TRADE', name: 'Trade Token', logoUrl: 'trade.png',
    launchpad: 'Clanker', launchMode: 'MIGRATED', quoteSource: 'GMGN_TRENCH'
  });
  assert.equal(loaded.api.routeTokenPlaceholder().token.symbol, 'TRADE');
  loaded.api.runtime.state.trades[0].tokenAddress = ADDRESS_B;
  assert.notEqual(loaded.api.routeTokenPlaceholder().token.symbol, 'TRADE');
});

test('trench and invalid token routes do not create placeholder detail contexts', async () => {
  for (const href of [
    'https://gmgn.ai/?chain=base',
    'https://gmgn.ai/base/token/not-an-address'
  ]) {
    const loaded = loadContent({
      href,
      readCurrentToken: async () => null,
      requestAnimationFrame: (callback) => { callback(); return 1; }
    });

    await loaded.api.start();

    assert.equal(loaded.api.runtime.current, null, href);
    assert.equal(loaded.api.renderPanel(), '', href);
  }
});

test('an exact GMGN supply immediately calibrates the current provisional position inside the mark throttle', async () => {
  const key = `base:${ADDRESS_A}`;
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    requestAnimationFrame: (callback) => { callback(); return 1; },
    updatePositionQuote(_token, _quote, state) {
      return {
        ...state,
        positions: { ...state.positions, [key]: { ...state.positions[key], quantity: 50 } }
      };
    }
  });
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'OLD', launchpad: 'Clanker' }, quote: {}
  };
  loaded.api.runtime.state.positions[key] = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'OLD', name: 'Old', quantity: 100,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 0.000002,
    lastPriceUsd: 0.000002, lastMarketCapUsd: 200_000, lastNativePriceUsd: 2_000,
    quoteObservedAt: loaded.clock.now - 1, totalSupply: 100_000_000_000,
    marketCapDivisor: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    launchpad: 'Clanker', needsCalibration: true, provisional: true, openedAt: 1
  };
  loaded.api.runtime.lastQuoteWriteAt = loaded.clock.now;
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'base', address: ADDRESS_A, symbol: '', name: '',
      priceUsd: 0, marketCapUsd: 0, totalSupply: 1_000_000_000,
      totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: loaded.clock.now,
      source: 'GMGN_NETWORK'
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.totalSupply, 1_000_000_000);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.supplySource, 'GMGN_EXACT');
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.priceUsd, 0.0002);
  assert.equal(loaded.api.runtime.state.positions[key].quantity, 50);
  assert.match(loaded.api.renderPanel(), /50 OLD/);
});

test('a duplicate in-flight calibration target does not schedule a redundant retry', async () => {
  const key = `base:${ADDRESS_A}`;
  const writeGate = deferred();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    updatePositionQuote(_token, _quote, state) {
      return writeGate.promise.then(() => state);
    }
  });
  loaded.api.runtime.current = {
    token: {
      chain: 'base', address: ADDRESS_A, symbol: 'CLANK', launchpad: 'Clanker',
      metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: {
      chain: 'base', address: ADDRESS_A, marketCapUsd: 200_000,
      totalSupply: 1_000_000_000, totalSupplySource: 'GMGN_NETWORK_EXACT',
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }
  };
  loaded.api.runtime.state.positions[key] = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'CLANK', name: 'Clank', quantity: 100,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 0.000002,
    lastPriceUsd: 0.000002, lastMarketCapUsd: 200_000, lastNativePriceUsd: 1,
    quoteObservedAt: loaded.clock.now - 1, totalSupply: 100_000_000_000,
    marketCapDivisor: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    launchpad: 'Clanker', needsCalibration: true, provisional: true,
    syntheticNativePrice: true, provisionalNativePrice: true, openedAt: 1
  };

  const firstRequest = loaded.api.queueImmediateCurrentCalibration();
  loaded.api.queueImmediateCurrentCalibration();
  assert.equal(loaded.calls.updatePositionQuotes.length, 1);

  writeGate.resolve();
  await firstRequest;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
});

test('a stronger native observation during supply calibration reruns immediately after settlement', async () => {
  const key = `base:${ADDRESS_A}`;
  const firstWrite = deferred();
  const secondWrite = deferred();
  let writeIndex = 0;
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    updatePositionQuote(_token, quote, state) {
      writeIndex += 1;
      const next = structuredClone(state);
      if (writeIndex === 1) {
        next.positions[key] = {
          ...next.positions[key], totalSupply: quote.totalSupply, supplySource: quote.supplySource,
          marketCapDivisor: quote.totalSupply, syntheticNativePrice: true,
          provisionalNativePrice: true, needsCalibration: true
        };
        return firstWrite.promise.then(() => next);
      }
      next.positions[key] = {
        ...next.positions[key], lastNativePriceUsd: quote.nativePriceUsd,
        syntheticNativePrice: false, provisionalNativePrice: false, needsCalibration: false
      };
      return secondWrite.promise.then(() => next);
    }
  });
  loaded.api.runtime.current = {
    token: {
      chain: 'base', address: ADDRESS_A, symbol: 'CLANK', launchpad: 'Clanker',
      metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: {
      chain: 'base', address: ADDRESS_A, marketCapUsd: 200_000,
      totalSupply: 1_000_000_000, totalSupplySource: 'GMGN_NETWORK_EXACT',
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }
  };
  loaded.api.runtime.state.positions[key] = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'CLANK', name: 'Clank', quantity: 100,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 0.000002,
    lastPriceUsd: 0.000002, lastMarketCapUsd: 200_000, lastNativePriceUsd: 1,
    quoteObservedAt: loaded.clock.now - 1, totalSupply: 100_000_000_000,
    marketCapDivisor: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    launchpad: 'Clanker', needsCalibration: true, provisional: true,
    syntheticNativePrice: true, provisionalNativePrice: true, openedAt: 1
  };

  const firstRequest = loaded.api.queueImmediateCurrentCalibration();
  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES',
    prices: [{ symbol: 'ETH', priceUsd: 2_000, observedAt: loaded.clock.now }]
  });
  assert.equal(loaded.calls.updatePositionQuotes.length, 1);

  firstWrite.resolve();
  await firstRequest;

  assert.equal(loaded.calls.updatePositionQuotes.length, 2);
  assert.equal(loaded.calls.updatePositionQuotes[1].quote.nativePriceUsd, 2_000);
  assert.equal(loaded.calls.updatePositionQuotes[1].quote.syntheticNativePrice, false);
  secondWrite.resolve();
  await new Promise((resolve) => setImmediate(resolve));
});

test('same-quality exact supply observations do not bypass the ordinary mark throttle', async () => {
  const key = `base:${ADDRESS_A}`;
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'EXACT', launchpad: 'Clanker' }, quote: {}
  };
  loaded.api.runtime.state.positions[key] = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'EXACT', name: 'Exact', quantity: 100,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 0.0002,
    lastPriceUsd: 0.0002, lastMarketCapUsd: 200_000, lastNativePriceUsd: 2_000,
    quoteObservedAt: loaded.clock.now - 1, totalSupply: 1_000_000_000,
    marketCapDivisor: 1_000_000_000, supplySource: 'GMGN_EXACT',
    launchpad: 'Clanker', needsCalibration: false, provisional: false, openedAt: 1
  };
  loaded.api.runtime.lastQuoteWriteAt = loaded.clock.now;
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'base', address: ADDRESS_A, symbol: 'EXACT', name: 'Exact',
      priceUsd: 0.00021, marketCapUsd: 210_000, totalSupply: 1_000_000_000,
      totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: loaded.clock.now,
      source: 'GMGN_NETWORK'
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
});

test('late verified Pump Mayhem mode is a same-rank immediate calibration upgrade', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/sol/token/${SOL_ADDRESS}` });
  loaded.api.rememberNativePrice('sol', 100, loaded.clock.now);
  const position = {
    chain: 'sol', tokenAddress: SOL_ADDRESS, symbol: 'PUMP', name: 'Pump', quantity: 1_000_000,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 0.00001,
    lastPriceUsd: 0.00001, lastMarketCapUsd: 10_000, lastNativePriceUsd: 100,
    quoteObservedAt: loaded.clock.now - 1, totalSupply: 1_000_000_000,
    marketCapDivisor: 1_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    launchpad: 'Pump.fun', launchMode: '', needsCalibration: true, provisional: false, openedAt: 1
  };
  const quote = loaded.api.resolvePaperTradeQuote({
    chain: 'sol', address: SOL_ADDRESS, symbol: 'PUMP', launchpad: 'Pump.fun', launchMode: 'Mayhem',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  }, {
    chain: 'sol', address: SOL_ADDRESS, marketCapUsd: 10_000,
    observedAt: loaded.clock.now, source: 'GMGN'
  }, { position });

  assert.equal(quote.totalSupply, 2_000_000_000);
  assert.equal(quote.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(quote.launchMode, 'Mayhem');
  assert.equal(loaded.api.positionCalibrationUpgrade(position, quote), true);
});

test('supply-only observations preserve synthetic price dimensions until real observations arrive', async () => {
  const key = `base:${ADDRESS_A}`;
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'SYN' }, quote: {}
  };
  loaded.api.runtime.state.positions[key] = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'SYN', name: 'Synthetic', quantity: 1,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 1,
    lastPriceUsd: 1, lastMarketCapUsd: 0, lastNativePriceUsd: 1,
    quoteObservedAt: loaded.clock.now - 1, totalSupply: 0, marketCapDivisor: 0, supplySource: '',
    needsCalibration: true, provisional: true, syntheticTokenPrice: true, syntheticNativePrice: true,
    provisionalTokenPrice: true, provisionalNativePrice: true, openedAt: 1
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'base', address: ADDRESS_A, totalSupply: 1_000_000_000,
      totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: loaded.clock.now,
      source: 'GMGN_NETWORK'
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.syntheticTokenPrice, true);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.syntheticNativePrice, true);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.provisional, true);

  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.clock.now += 1;
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'base', address: ADDRESS_A, priceUsd: 2, totalSupply: 1_000_000_000,
      totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: loaded.clock.now,
      source: 'GMGN_NETWORK'
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.calls.updatePositionQuotes.length, 2);
  assert.equal(loaded.calls.updatePositionQuotes[1].quote.syntheticTokenPrice, false);
  assert.equal(loaded.calls.updatePositionQuotes[1].quote.syntheticNativePrice, false);
});

test('a passive native-price arrival immediately calibrates the current position without timer advancement', async () => {
  const key = `base:${ADDRESS_A}`;
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'NATIVE' },
    quote: { chain: 'base', address: ADDRESS_A, priceUsd: 2, source: 'GMGN_NETWORK', observedAt: loaded.clock.now }
  };
  loaded.api.runtime.state.positions[key] = {
    chain: 'base', tokenAddress: ADDRESS_A, symbol: 'NATIVE', name: 'Native', quantity: 1,
    costBasisNative: 1, realizedPnlNative: 0, averageEntryPriceUsd: 2,
    lastPriceUsd: 2, lastMarketCapUsd: 0, lastNativePriceUsd: 1,
    quoteObservedAt: loaded.clock.now - 1, totalSupply: 0, marketCapDivisor: 0, supplySource: '',
    needsCalibration: true, provisional: true, syntheticTokenPrice: false, syntheticNativePrice: true,
    provisionalTokenPrice: false, provisionalNativePrice: true, openedAt: 1
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES', prices: [{
      symbol: 'ETH', priceUsd: 2_000, observedAt: loaded.clock.now
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.nativePriceUsd, 2_000);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.syntheticNativePrice, false);
});

test('an exact-chain GMGN network quote bootstraps every supported detail panel when DOM metadata is unavailable', () => {
  for (const { id: chain } of Chains.all()) {
    const address = chain === 'sol' ? SOL_ADDRESS : ADDRESS_A;
    const loaded = loadContent({
      href: `https://gmgn.ai/${chain}/token/${address}`,
      readCurrentToken: async () => null,
      requestAnimationFrame: (callback) => { callback(); return 1; }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.detailRouteToken())), { chain, address });
    assert.equal(loaded.api.acceptedTokenObservation({
      priceUsd: 2, observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }, { chain, address }), true);
    loaded.api.dispatchPageMessage({
      source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
        chain, address, symbol: 'TEST', name: 'Test Token', logoUrl: '',
        priceUsd: 2, marketCapUsd: 2_000, liquidityUsd: 500,
        observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
      }]
    });

    assert.equal(loaded.api.runtime.gmgnQuotes.size, 1, chain);
    assert.equal(loaded.api.runtime.current?.token.chain, chain);
    assert.equal(loaded.api.runtime.current?.token.address, address);
    assert.equal(loaded.api.runtime.current?.token.metadataSource, 'GMGN_NETWORK');
    assert.match(loaded.api.renderPanel(), /TEST/);
  }
});

test('a GMGN network quote cannot bootstrap a detail context for another chain or a trench route', () => {
  for (const href of [`https://gmgn.ai/base/token/${ADDRESS_A}`, 'https://gmgn.ai/?chain=bsc']) {
    const loaded = loadContent({ href, requestAnimationFrame: (callback) => { callback(); return 1; } });
    loaded.api.dispatchPageMessage({
      source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
        chain: 'bsc', address: ADDRESS_A, symbol: 'WRONG', name: 'Wrong Chain',
        priceUsd: 2, marketCapUsd: 2_000, observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
      }]
    });
    assert.equal(loaded.api.runtime.current, null);
    assert.equal(loaded.api.renderPanel(), '');
  }
});

test('market-cap-only GMGN detail metadata can show the panel but remains non-executable', () => {
  const loaded = loadContent({
    href: `https://gmgn.ai/bsc/token/${ADDRESS_A}`,
    readCurrentToken: async () => null,
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });
  loaded.api.rememberNativePrice('bsc', 600, loaded.clock.now);
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'bsc', address: ADDRESS_A, symbol: 'TEST', name: 'Test Token',
      priceUsd: 0, marketCapUsd: 2_000, observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }]
  });

  assert.equal(loaded.api.runtime.current?.token.chain, 'bsc');
  assert.match(loaded.api.renderPanel(), /TEST/);
  assert.throws(() => loaded.api.requireExecutableQuote(
    loaded.api.runtime.current.token, loaded.api.runtime.current.quote
  ), /invalidQuote/);
});

test('SPA detail navigation establishes a placeholder and requests a GMGN quote replay', async () => {
  const loaded = loadContent({
    href: `https://gmgn.ai/eth/token/${ADDRESS_A}`,
    readCurrentToken: async () => null,
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });
  loaded.api.runtime.current = quoteContext(ADDRESS_A);
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  const nextQuote = {
    chain: 'eth', address: ADDRESS_B, symbol: 'NEXT', name: 'Next Token',
    priceUsd: 3, marketCapUsd: 3_000, observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
  };
  loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [nextQuote] });
  assert.equal(loaded.api.runtime.gmgnQuotes.size, 1);
  assert.equal(loaded.api.runtime.current.token.address, ADDRESS_A);
  loaded.pageMessages.length = 0;

  loaded.api.handleRouteChange();

  assert.equal(loaded.api.runtime.current?.token.chain, 'eth');
  assert.equal(loaded.api.runtime.current?.token.address, ADDRESS_B);
  assert.equal(loaded.api.runtime.current?.token.metadataVerified, false);
  assert.equal(loaded.api.runtime.gmgnQuotes.size, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.pageMessages)), [{
    source: 'TANGO_PAPER_CONTENT', type: 'REQUEST_QUOTES'
  }]);
  loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [nextQuote] });
  assert.equal(loaded.api.runtime.current?.token.address, ADDRESS_B);
  assert.match(loaded.api.renderPanel(), /NEXT/);
  await new Promise((resolve) => setImmediate(resolve));
});

test('a delayed empty DOM detail read cannot erase a same-route GMGN network fallback', async () => {
  const domRead = deferred();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_B}`,
    readCurrentToken: () => domRead.promise,
    requestAnimationFrame: (callback) => { callback(); return 1; }
  });
  const tick = loaded.api.performQuoteTick();
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'base', address: ADDRESS_B, symbol: 'FALLBACK', name: 'Fallback Token',
      priceUsd: 4, marketCapUsd: 4_000, observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }]
  });
  assert.equal(loaded.api.runtime.current?.token.address, ADDRESS_B);

  domRead.resolve(null);
  await tick;

  assert.equal(loaded.api.runtime.current?.token.address, ADDRESS_B);
  assert.match(loaded.api.renderPanel(), /FALLBACK/);
});

test('content Engine mark fixture derives trusted Pump market-cap prices like production', () => {
  const loaded = loadContent({
    href: 'https://gmgn.ai/sol/token/AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP'
  });
  const position = {
    chain: 'sol', tokenAddress: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    quantity: 100_000, costBasisNative: 1, averageEntryPriceUsd: 0.000003,
    lastPriceUsd: 0.000003, lastMarketCapUsd: 3_000, lastNativePriceUsd: 100,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
  };
  const quote = {
    priceUsd: 0, marketCapUsd: 6_000, nativePriceUsd: 100,
    observedAt: loaded.clock.now, nativePriceObservedAt: loaded.clock.now,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };

  const mark = loaded.context.Tango.Engine.markPosition(position, quote);
  assert.equal(mark.priceUsd, 0.000006);
  assert.equal(mark.valueNative, 0.006);
});

test('a confirmation callback captured on one token cannot execute after same-chain navigation', async () => {
  const loaded = loadContent();
  const context = quoteContext();
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  await loaded.api.buy(1, context);
  const staleAction = loaded.api.runtime.modal.action;
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  await staleAction();
  assert.equal(loaded.calls.buy, 0);
});

test('quick-buy commits before same-chain navigation and background native refresh cannot duplicate it', async () => {
  const nativeGate = deferred();
  const loaded = loadContent({
    sendMessage: (message) => message.type === 'TANGO_GET_NATIVE_PRICE' ? nativeGate.promise : Promise.resolve({ ok: true })
  });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  const action = loaded.api.handleQuickBuy({ ...quoteContext(), amountNative: 1 });
  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceUsd, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.provisional, true);
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  nativeGate.resolve({ ok: true, price: 3_000, observedAt: loaded.clock.now });
  await action;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded.calls.buy, 1);
});

test('quick-buy freezes complete click-time metadata before same-chain navigation', async () => {
  const loaded = loadContent();
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  const context = {
    token: {
      chain: 'eth', address: ADDRESS_A, symbol: 'CLICK', name: 'Click Token', logoUrl: 'click.png',
      launchpad: 'Clanker', launchMode: 'MIGRATED', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: {
      priceUsd: 2, marketCapUsd: 200_000, source: 'GMGN_TRENCH', observedAt: loaded.clock.now
    },
    amountNative: 1,
    sourceUrl: `https://gmgn.ai/eth/token/${ADDRESS_A}`
  };

  const action = loaded.api.handleQuickBuy(context);
  context.token.chain = 'base';
  context.token.address = ADDRESS_B;
  context.token.symbol = 'STALE';
  context.token.name = 'Stale Token';
  context.token.logoUrl = 'stale.png';
  context.token.launchpad = 'Bankr';
  context.quote.marketCapUsd = 999_999;
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  await action;

  const order = loaded.calls.buyOrders[0];
  assert.deepEqual(JSON.parse(JSON.stringify(order.token)), {
    chain: 'eth', address: ADDRESS_A, symbol: 'CLICK', name: 'Click Token', logoUrl: 'click.png',
    launchpad: 'Clanker', launchMode: 'MIGRATED', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  });
  assert.equal(order.quote.marketCapUsd, 200_000);
  assert.equal(order.sourceUrl, `https://gmgn.ai/eth/token/${ADDRESS_A}`);
});

test('stale or untrusted populated GMGN fields still request verified DEX fallback', () => {
  const loaded = loadContent();
  const stale = quoteContext(ADDRESS_A);
  stale.quote.observedAt = loaded.clock.now - 20_000;
  const untrusted = quoteContext(ADDRESS_B);
  untrusted.quote.source = 'PAGE_TEXT';
  loaded.api.ensureTokenQuote(stale);
  loaded.api.ensureTokenQuote(untrusted);
  const tokenRequests = loaded.messages.filter((message) => message.type === 'TANGO_GET_TOKEN_QUOTE');
  assert.deepEqual(tokenRequests.map((message) => message.address), [ADDRESS_A, ADDRESS_B]);
});

test('content preserves the background native observation timestamp instead of restamping receipt', async () => {
  const loaded = loadContent({
    sendMessage: async (message) => message.type === 'TANGO_GET_NATIVE_PRICE'
      ? { ok: true, price: 3_000, observedAt: 971_000 }
      : { ok: true }
  });
  const context = quoteContext();
  loaded.api.ensureNativePrice(context);
  await loaded.api.runtime.nativePricePromises.get('eth');
  assert.equal(loaded.api.runtime.nativePriceObservedAt.get('eth'), 971_000);
  loaded.clock.now += 2_000;
  assert.equal(loaded.api.freshNativePrice('eth'), 0);
});

test('execution uses a stale local native observation immediately and refreshes it in background', async () => {
  const loaded = loadContent({
    sendMessage: async (message) => message.type === 'TANGO_GET_NATIVE_PRICE'
      ? { ok: true, price: 3_100, observedAt: loaded.clock.now }
      : { ok: true }
  });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now - 15_001);

  await loaded.api.handleQuickBuy({ ...quoteContext(), amountNative: 1 });

  const nativeRequests = loaded.messages.filter((message) => message.type === 'TANGO_GET_NATIVE_PRICE');
  assert.equal(nativeRequests.length, 1);
  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceUsd, 3_000);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceObservedAt, loaded.clock.now);
  const refresh = loaded.api.runtime.nativePricePromises.get('eth');
  if (refresh) await refresh;
  assert.equal(loaded.api.runtime.nativePrices.get('eth'), 3_100);
});

test('quick buy uses exact-address last-known token and native prices when refresh is unavailable', async () => {
  const loaded = loadContent({ sendMessage: async () => ({ ok: false }) });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  const context = quoteContext();
  context.amountNative = 1;
  context.quote.observedAt = loaded.clock.now - 60_000;
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now - 60_000);

  const action = loaded.api.handleQuickBuy(context);
  loaded.clock.now += 1_000;
  await action;

  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceUsd, 3_000);
  assert.equal(loaded.calls.buyOrders[0].quote.paperFallback, true);
  assert.equal(loaded.api.runtime.toast?.type, 'success');
});

test('position drawer sell uses the position last-known quote instead of failing as stale', async () => {
  const loaded = loadContent({ sendMessage: async () => ({ ok: false }) });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  const position = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', name: 'Test Token',
    quantity: 2, costBasisNative: 1, lastPriceUsd: 2, lastMarketCapUsd: 2_000,
    lastNativePriceUsd: 3_000, quoteObservedAt: loaded.clock.now - 60_000
  };
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = position;

  const action = loaded.api.sellPosition(position, 50);
  loaded.clock.now += 1_000;
  await action;

  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, 2);
  assert.equal(loaded.calls.sellOrders[0].quote.nativePriceUsd, 3_000);
  assert.equal(loaded.calls.sellOrders[0].quote.paperFallback, true);
});

test('exact-chain GMGN network metadata corrects only the matching position', async () => {
  const loaded = loadContent();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'WRONG', name: 'Wrong', logoUrl: 'wrong.png'
  };
  loaded.api.runtime.state.positions[`eth:${ADDRESS_B}`] = {
    chain: 'eth', tokenAddress: ADDRESS_B, symbol: 'OTHER', name: 'Other', logoUrl: 'other.png'
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'eth', address: ADDRESS_A, priceUsd: 2, marketCapUsd: 2_000,
      symbol: 'RIGHT', name: 'Right Token', logoUrl: 'right.png',
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.calls.metadataBatches.length, 1);
  assert.equal(loaded.calls.metadataBatches[0].length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.metadataBatches[0][0])), {
    chain: 'eth', address: ADDRESS_A, symbol: 'RIGHT', name: 'Right Token', logoUrl: 'right.png',
    metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  });
});

test('PnL calendar exposes current-chain trade history and sends the active chain', async () => {
  const loaded = loadContent();
  loaded.api.runtime.calendarOpen = true;
  assert.match(loaded.api.renderPnlCalendar(), /data-action="dashboard-history"/);
  const history = eventElement({ dataset: { action: 'dashboard-history' } });
  loaded.shellLists.set('[data-action]', [history]);
  loaded.api.bindEvents();

  await history.emit('click', { stopPropagation() {} });

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.messages.at(-1))), {
    type: 'TANGO_OPEN_DASHBOARD', tab: 'history', chain: 'eth'
  });
});

test('an old failed quote request cannot suppress or remove a newer away-and-back request', async () => {
  const oldGate = deferred();
  const currentGate = deferred();
  let tokenRequestCount = 0;
  const loaded = loadContent({
    sendMessage: (message) => {
      if (message.type !== 'TANGO_GET_TOKEN_QUOTE') return Promise.resolve({ ok: true });
      tokenRequestCount += 1;
      return tokenRequestCount === 1 ? oldGate.promise : currentGate.promise;
    }
  });
  const stale = quoteContext();
  stale.quote.observedAt = loaded.clock.now - 20_000;
  const key = `TANGO_GET_TOKEN_QUOTE:eth:${ADDRESS_A}`;

  loaded.api.ensureTokenQuote(stale);
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_A}`;
  loaded.api.handleRouteChange();
  loaded.api.ensureTokenQuote(stale);
  const currentRequest = loaded.api.runtime.quoteRequests.get(key);

  oldGate.resolve({ ok: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded.api.runtime.quoteRequests.get(key), currentRequest);
  assert.equal(loaded.api.runtime.quoteRetryAt.has(`eth:${ADDRESS_A}`), false);

  currentGate.resolve({ ok: false });
  await currentRequest;
});

test('supplyless EVM market-cap observation fills provisionally before background DEX refresh', async () => {
  const loaded = loadContent({
    sendMessage: async (message) => message.type === 'TANGO_GET_TOKEN_QUOTE'
      ? {
        ok: true,
        quote: { priceUsd: 2, marketCapUsd: 2_000, source: 'DEXSCREENER', observedAt: 1_000_000 }
      }
      : { ok: true }
  });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  const context = {
    ...quoteContext(),
    amountNative: 1,
    quote: {
      priceUsd: 0,
      marketCapUsd: 2_000,
      source: 'GMGN_NETWORK',
      observedAt: loaded.clock.now,
      valuationMode: 'MARKET_CAP',
      marketCapDivisor: 1_000_000_000
    }
  };

  const action = loaded.api.handleQuickBuy(context);
  loaded.clock.now += 1_000;
  await action;

  assert.equal(loaded.messages.some((message) => message.type === 'TANGO_GET_TOKEN_QUOTE'), true);
  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 2_000 / 1_000_000_000);
  assert.equal(loaded.calls.buyOrders[0].quote.source, 'TANGO_FALLBACK');
  assert.equal(loaded.calls.buyOrders[0].quote.provisional, true);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceObservedAt, loaded.clock.now - 1_000);
});

test('non-Pump Solana market cap fills provisionally while real-price refresh stays background-only', async () => {
  const address = 'So11111111111111111111111111111111111111112';
  const trenchContext = () => ({
    token: {
      chain: 'sol', address, symbol: 'SOLTEST', name: 'Sol Test',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: {
      priceUsd: 0,
      marketCapUsd: 10_000,
      source: 'GMGN_TRENCH_MC',
      observedAt: 1_000_000,
      valuationMode: 'MARKET_CAP',
      marketCapDivisor: 1_000_000_000
    },
    amountNative: 1
  });
  const href = `https://gmgn.ai/sol/token/${address}`;
  const unavailable = loadContent({
    href,
    sendMessage: async (message) => message.type === 'TANGO_GET_TOKEN_QUOTE'
      ? { ok: true }
      : { ok: true }
  });
  unavailable.api.runtime.settings.fastMode = true;
  unavailable.api.runtime.settings.confirmationEnabled = false;
  unavailable.api.rememberNativePrice('sol', 100, unavailable.clock.now);
  const rejected = unavailable.api.handleQuickBuy(trenchContext());
  unavailable.clock.now += 1_000;
  await rejected;
  assert.equal(unavailable.messages.some((message) => message.type === 'TANGO_GET_TOKEN_QUOTE'), true);
  assert.equal(unavailable.calls.buy, 1);
  assert.equal(unavailable.calls.buyOrders[0].quote.priceUsd, 10_000 / 1_000_000_000);
  assert.equal(unavailable.calls.buyOrders[0].quote.provisional, true);

  const resolved = loadContent({
    href,
    sendMessage: async (message) => message.type === 'TANGO_GET_TOKEN_QUOTE'
      ? {
        ok: true,
        quote: {
          priceUsd: 0.002,
          marketCapUsd: 12_000,
          source: 'DEXSCREENER',
          observedAt: 1_000_000
        }
      }
      : { ok: true }
  });
  resolved.api.runtime.settings.fastMode = true;
  resolved.api.runtime.settings.confirmationEnabled = false;
  resolved.api.rememberNativePrice('sol', 100, resolved.clock.now);
  const accepted = resolved.api.handleQuickBuy(trenchContext());
  resolved.clock.now += 1_000;
  await accepted;
  assert.equal(resolved.messages.some((message) => message.type === 'TANGO_GET_TOKEN_QUOTE'), true);
  assert.equal(resolved.calls.buy, 1);
  assert.equal(resolved.calls.buyOrders[0].quote.priceUsd, 10_000 / 1_000_000_000);
  assert.equal(resolved.calls.buyOrders[0].quote.source, 'TANGO_FALLBACK');
  assert.equal(resolved.calls.buyOrders[0].quote.provisional, true);
  assert.equal(resolved.calls.buyOrders[0].quote.valuationMode, 'PRICE');
  assert.equal(resolved.calls.buyOrders[0].quote.nativePriceObservedAt, resolved.clock.now - 1_000);
});

test('content validates a persisted Pump market-cap position after detail metadata replaces trench metadata', () => {
  const address = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
  const loaded = loadContent({ href: `https://gmgn.ai/sol/token/${address}` });
  const position = {
    chain: 'sol',
    tokenAddress: address,
    symbol: 'PUMP',
    metadataSource: 'GMGN_DETAIL',
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1',
    valuationMode: 'MARKET_CAP',
    marketCapDivisor: 1_000_000_000
  };
  const quote = {
    priceUsd: 0,
    marketCapUsd: 4_000,
    source: 'GMGN_TRENCH_MC',
    observedAt: loaded.clock.now,
    valuationMode: 'MARKET_CAP',
    marketCapDivisor: 1_000_000_000
  };
  loaded.api.runtime.state.positions[`sol:${address}`] = position;
  loaded.api.runtime.gmgnQuotes.set(`sol:${address}`, quote);
  loaded.api.rememberNativePrice('sol', 100, loaded.clock.now);

  assert.ok(loaded.api.requireExecutableQuote({ chain: 'sol', address, metadataSource: 'GMGN_DETAIL' }, quote));
  assert.ok(loaded.api.freshExecutableQuote(position));
});

test('trade confirmation displays market cap instead of a synthetic Pump token price', async () => {
  const address = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
  const loaded = loadContent({ href: `https://gmgn.ai/sol/token/${address}` });
  loaded.api.runtime.settings.chains.sol = { buyPresets: [1], networkFeeNative: 0 };
  loaded.api.runtime.state.positions[`sol:${address}`] = {
    chain: 'sol', tokenAddress: address, quantity: 1, costBasisNative: 1,
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  loaded.api.rememberNativePrice('sol', 100, loaded.clock.now);
  await loaded.api.buy(1, {
    token: { chain: 'sol', address, symbol: 'PUMP' },
    quote: {
      priceUsd: 0, marketCapUsd: 4_000, source: 'GMGN_TRENCH_MC', observedAt: loaded.clock.now,
      valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
    }
  });

  assert.deepEqual(Array.from(loaded.api.runtime.modal.rows, (row) => Array.from(row)).filter(([key]) => key === 'marketCap'), [
    ['marketCap', '$4000']
  ]);
  assert.equal(loaded.api.runtime.modal.rows.some(([key]) => key === 'observedPrice' || key === 'executionPrice'), false);
});
