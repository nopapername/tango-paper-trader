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
global.Tango.NativeQuickBuyGuard = {
  registerPaperAction: () => true,
  isPaperActionTrusted: () => true,
  revokePaperAction: () => true
};
const RealState = require('../src/core/state.js');
const RealEngine = require('../src/core/engine.js');
const StateCoordinator = require('../src/core/state-coordinator.js');
const GMGNQuotes = require('../src/adapters/gmgn-quotes.js');
const RealGMGN = require('../src/adapters/gmgn.js');
const RealMarkers = require('../src/content/markers.js');
const contentSource = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
const START = "  start().catch((error) => console.error('[Tango Paper Trader]', error));";
const EXPOSE = `  global.__contentTest = {
    runtime, start, performRefresh, refresh, refreshRecoverably, performQuoteTick, handleRouteChange, handleQuickBuy, buy, sell, sellPosition, sellBreakeven,
    ensureTokenQuote, ensureNativePrice, freshNativePrice, rememberNativePrice,
    resolvePaperTradeQuote, positionCalibrationUpgrade, queueImmediateCurrentCalibration, paperExecutableQuote,
    requireExecutableQuote, freshExecutableQuote, renderPanel, renderBar, renderDrawer, requestCloseAll,
    commitCloseAll, savePresetEdits, bindEvents, bindDraggable, render, renderHeaderAccountSummary,
    detailRouteToken, routeTokenPlaceholder, ensureRouteTokenContext, acceptedTokenObservation, renderPnlCalendar,
    chartMarkerPayload, syncChartMarkers, syncQuickBuyButtons, clearQuickBuyButtons,
    executionValidationTrustContext: typeof executionValidationTrustContext === 'function'
      ? executionValidationTrustContext : null,
    dispatchPageMessage: (data) => handlePageMessage({ source: window, data }),
    dispatchWindowMessage: (event) => handlePageMessage(event)
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

function mutationQuickBuyHarness(address = ADDRESS_A, { tokenItem = false } = {}) {
  let currentAddress = address;
  let metadataReady = true;
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
    get innerText() { return metadataReady ? `${currentAddress}\nTOKEN Token Name\nMC\n$10K` : 'loading'; },
    get textContent() { return this.innerText; },
    getAttribute(name) {
      return name === 'href' && currentAddress
        ? `https://gmgn.ai/base/token/${currentAddress}` : null;
    },
    matches(selector) {
      return (tokenItem && selector === '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]')
        || selector === '[class~="group/a"]';
    },
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
    captureCalls: 0,
    bubbleCalls: 0,
    realHandlerCalls: 0,
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
    setMetadataReady(ready) { metadataReady = Boolean(ready); },
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
  href = `https://gmgn.ai/eth/token/${ADDRESS_A}`, getAll, readCurrentToken, readTrenchSnapshot,
  readVerifiedCurrentTokenSnapshot, sendMessage, patchSettings,
  updatePositionQuote,
  chartFrames = [],
  chartFrameVariant = 'financial-title',
  markChartFrameReady,
  requestAnimationFrame = () => 0, timer = setTimeout, logger = console,
  MutationObserver = class { observe() {} }
} = {}) {
  global.Tango.Supply = Supply;
  assert.notEqual(instrumentedSource, contentSource, 'content test harness must replace startup with runtime exports');
  const messages = [];
  const pageMessages = [];
  const calls = {
    buy: 0, buyOrders: [], sell: 0, sellOrders: [], metadataBatches: [],
    closeAll: 0, closeAllOrders: [], patches: [], fullSaves: [], getAll: 0, chainUsdSummaries: [],
    updatePositionQuotes: [], readCurrentToken: 0, readVerifiedCurrentTokenSnapshot: 0,
    discoverTokenCards: 0, clearQuickBuy: 0,
    quickBuyEvents: [], clearQuickBuyRestore: [], storeSubscriber: null,
    chartReady: [], chartInvalidations: [], chartTrustClears: 0
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
  const chartSelectorMatchesFixture = (selector) => {
    const branches = String(selector || '').split(',').map((branch) => branch.trim());
    if (chartFrameVariant === 'tradingview-title') {
      return branches.includes('iframe[title="TradingView"]');
    }
    if (chartFrameVariant === 'tradingview-container') {
      return branches.includes('[data-sentry-component="TradingView"] iframe');
    }
    return branches.includes('iframe[title="Financial Chart"]');
  };
  const document = {
    body: genericElement(), head: genericElement(),
    documentElement: genericElement(),
    createElement() { createCount += 1; return createCount === 1 ? host : createCount === 3 ? shell : genericElement(); },
    querySelector(selector) {
      if (chartSelectorMatchesFixture(selector)) return chartFrames[0] || null;
      return documentSingles.get(selector) || null;
    },
    querySelectorAll(selector) {
      return chartSelectorMatchesFixture(selector) ? chartFrames : [];
    }, addEventListener() {}
  };
  const windowListeners = new Map();
  const storageChangeListeners = [];
  const context = {
    console: logger,
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
      },
      storage: {
        onChanged: {
          addListener(listener) { storageChangeListeners.push(listener); }
        }
      }
    }
  };
  context.window = context;
  context.Tango = {
    SETTINGS_KEY: global.Tango.SETTINGS_KEY,
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
    Markers: RealMarkers,
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
      clearQuickBuy(restoreCurrent) {
        calls.clearQuickBuy += 1;
        calls.clearQuickBuyRestore.push(restoreCurrent);
        calls.quickBuyEvents.push({
          type: 'clear',
          safetyActive: document.documentElement.classList.contains('tango-paper-quick-buy-active')
        });
      },
      discoverTokenCards(_onQuickBuy, amountNative, paperLabel) {
        calls.discoverTokenCards += 1;
        calls.quickBuyEvents.push({
          type: 'discover', amountNative, paperLabel,
          safetyActive: document.documentElement.classList.contains('tango-paper-quick-buy-active')
        });
        return 0;
      },
      readTrenchSnapshot: (chain, address) => readTrenchSnapshot ? readTrenchSnapshot(chain, address) : null,
      readVisibleTokenMetadata: () => [],
      readCurrentToken: async () => {
        calls.readCurrentToken += 1;
        return readCurrentToken ? readCurrentToken() : null;
      },
      readVerifiedCurrentTokenSnapshot(token) {
        calls.readVerifiedCurrentTokenSnapshot += 1;
        return readVerifiedCurrentTokenSnapshot ? readVerifiedCurrentTokenSnapshot(token) : null;
      },
      _isTokenDetailPage: () => {
        const parts = new URL(context.location.href).pathname.split('/').filter(Boolean);
        return parts[1] === 'token' && Boolean(context.Tango.Chains.get(parts[0]));
      },
      tokenAddressFromUrl: (url = context.location.href) => RealGMGN.tokenAddressFromUrl(url),
      resolveCurrentTokenRead(previous, next, url = context.location.href) {
        if (next) return next;
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const routeAddress = parts[1] === 'token' ? parts[2]?.toLowerCase() : '';
        return previous?.token && previous.token.chain === parts[0]
          && previous.token.address.toLowerCase() === routeAddress ? previous : null;
      },
      needsCurrentTokenRead: () => false,
      _markChartFrameReady(frame, token) {
        calls.chartReady.push({ frame, token: { ...token } });
        return markChartFrameReady ? markChartFrameReady(frame, token) : true;
      },
      _invalidateChartFrame(frame) { calls.chartInvalidations.push(frame); },
      _clearChartTrust() { calls.chartTrustClears += 1; }
    }
  };
  vm.runInNewContext(instrumentedSource, context, { filename: 'src/content/content.js' });
  const api = context.__contentTest;
  api.runtime.state = defaultState();
  api.runtime.settings = defaultSettings();
  api.runtime.activeChainId = Chains.fromUrl(href)?.id || null;
  return {
    api, calls, clock, context, createDomNode: genericElement, documentSingles, messages, pageMessages,
    shadowLists, shadowSingles, shell, shellLists, windowListeners,
    dispatchStorageChange(changes, areaName = 'local') {
      storageChangeListeners.forEach((listener) => listener(changes, areaName));
    }
  };
}

function chartFrame() {
  const messages = [];
  const listeners = new Map();
  return {
    messages,
    contentWindow: { postMessage(message) { messages.push(message); } },
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    dispatch(type) {
      (listeners.get(type) || []).forEach((listener) => listener({ type, target: this }));
    }
  };
}

function markerPayloads(frame) {
  return frame.messages
    .filter((message) => message?.source === 'TANGO_PAPER_PARENT' && message?.type === 'CHART_MARKERS')
    .map((message) => JSON.parse(JSON.stringify(message.payload)));
}

function chartReadyProbes(frame) {
  return frame.messages.filter((message) => (
    message?.source === 'TANGO_PAPER_PARENT' && message?.type === 'CHART_READY_PROBE'
  ));
}

function chartReadyIdentity(chain, address) {
  return { chain, address };
}

function assertOnlyUnscopedCleanup(frame, message) {
  const payloads = markerPayloads(frame);
  assert.ok(payloads.length > 0, `${message}: expected at least one cleanup payload`);
  payloads.forEach((payload) => assert.deepEqual(payload, { markers: [] }, message));
}

test('a directly TradingView-titled chart frame receives current-token markers', () => {
  const frame = chartFrame();
  const loaded = loadContent({
    chartFrames: [frame],
    chartFrameVariant: 'tradingview-title'
  });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 1,
    averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1
  };

  loaded.api.syncChartMarkers(true);

  assert.equal(markerPayloads(frame).at(-1)?.markers?.[0]?.id, `entry:eth:${ADDRESS_A}`);
});

test('current-route frame registration and loads probe for READY without marker-driven repeats', () => {
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });

  loaded.api.syncChartMarkers(true);
  assert.equal(chartReadyProbes(frame).length, 1, 'first current-route registration probes once');
  const initialProbeId = chartReadyProbes(frame)[0].probeId;
  assert.equal(typeof initialProbeId, 'string');
  assert.ok(initialProbeId.length > 0);

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY', probeId: `${initialProbeId}:stale` }
  });
  assert.equal(loaded.calls.chartReady.length, 0, 'a mismatched response cannot establish trust');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY', probeId: initialProbeId }
  });
  assert.equal(loaded.calls.chartReady.length, 1, 'the outstanding matching response establishes trust once');

  for (let index = 0; index < 20; index += 1) loaded.api.syncChartMarkers(true);
  assert.equal(chartReadyProbes(frame).length, 1, 'marker publications never cause another probe');

  frame.dispatch('load');
  frame.dispatch('load');
  assert.equal(chartReadyProbes(frame).length, 3, 'each current-route load sends exactly one probe');
  assert.equal(new Set(chartReadyProbes(frame).map((message) => message.probeId)).size, 3,
    'every probe generation has a distinct correlation id');

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();
  frame.dispatch('load');
  assert.equal(chartReadyProbes(frame).length, 5,
    'route advance and the later loaded document each receive one quarantined probe');
  assert.equal(new Set(chartReadyProbes(frame).map((message) => message.probeId)).size, 5,
    'neither route nor document rebind can reuse an earlier probe generation');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  assert.equal(loaded.calls.chartReady.length, 1,
    'the quarantined frame cannot use an untagged delayed response to bind the new route');
});

test('retained A stays cleaned while independently verified B receives B markers', () => {
  const oldFrame = chartFrame();
  const frames = [oldFrame];
  const loaded = loadContent({
    href: `https://gmgn.ai/eth/token/${ADDRESS_A}`,
    chartFrames: frames
  });
  loaded.api.syncChartMarkers();
  oldFrame.messages.length = 0;

  loaded.api.runtime.state.positions[`eth:${ADDRESS_B}`] = {
    chain: 'eth', tokenAddress: ADDRESS_B, symbol: 'NEXT', quantity: 1,
    averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
  };
  const newFrame = chartFrame();
  frames.push(newFrame);
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();

  assert.deepEqual(markerPayloads(oldFrame), [{ markers: [] }],
    'a stale frame receives cleanup but never the scoped B payload');
  assertOnlyUnscopedCleanup(newFrame, 'new B stays quarantined until its correlated identity response');
  const probe = chartReadyProbes(newFrame).at(-1);
  loaded.api.dispatchWindowMessage({
    source: newFrame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: probe.probeId,
      identity: chartReadyIdentity('eth', ADDRESS_B)
    }
  });
  const currentPayload = markerPayloads(newFrame).at(-1);
  assert.equal(currentPayload.tokenAddress, ADDRESS_B);
  assert.equal(currentPayload.markers[0].id, `entry:eth:${ADDRESS_B}`);
});

test('delayed READY and load from retained A cannot replay B marker state', () => {
  const oldFrame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/eth/token/${ADDRESS_A}`,
    chartFrames: [oldFrame]
  });
  loaded.api.syncChartMarkers();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_B}`] = {
    chain: 'eth', tokenAddress: ADDRESS_B, symbol: 'NEXT', quantity: 1,
    averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
  };
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();
  oldFrame.messages.length = 0;

  loaded.api.dispatchWindowMessage({
    source: oldFrame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  assert.deepEqual(markerPayloads(oldFrame), [], 'stale READY cannot replay B');

  oldFrame.dispatch('load');
  assertOnlyUnscopedCleanup(oldFrame, 'stale load may clean but cannot replay B');
  assert.equal(loaded.calls.chartReady.length, 0);
});

test('current B frame rejects a token-bearing marker payload for A', () => {
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/eth/token/${ADDRESS_B}`,
    chartFrames: [frame]
  });
  loaded.api.syncChartMarkers();
  frame.messages.length = 0;

  loaded.api.runtime.current = quoteContext(ADDRESS_A);
  loaded.api.syncChartMarkers(true);

  assert.deepEqual(markerPayloads(frame), [],
    'even a token-scoped empty payload must match the frame and detail route');
});

test('an A-era chart frame cannot bind a later route after loading', () => {
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });

  loaded.api.syncChartMarkers();
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();

  const probesBeforeReload = chartReadyProbes(frame).length;
  frame.dispatch('load');
  assert.deepEqual(loaded.calls.chartInvalidations, [frame]);
  assert.equal(chartReadyProbes(frame).length, probesBeforeReload + 1,
    'the reused node receives one quarantined current-route probe after its new document loads');
  const rebindProbe = chartReadyProbes(frame).at(-1);
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: rebindProbe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_A)
    }
  });
  assert.equal(loaded.calls.chartReady.length, 0,
    'an untagged or independently A-identified response cannot bind the reused frame to B');
  assert.ok(loaded.calls.chartTrustClears >= 1);
});

test('a chart iframe reused for a new route rebinds only after correlated current-token identity', () => {
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });
  loaded.api.syncChartMarkers();
  loaded.api.runtime.state.positions[`base:${ADDRESS_B}`] = {
    chain: 'base', tokenAddress: ADDRESS_B, symbol: 'NEXT', quantity: 1,
    averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
  };

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();
  frame.dispatch('load');
  const probe = chartReadyProbes(frame).at(-1);
  assert.equal(typeof probe?.probeId, 'string');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: probe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_B)
    }
  });

  assert.deepEqual(loaded.calls.chartReady.at(-1)?.token, {
    chain: 'base', address: ADDRESS_B
  });
  assert.equal(markerPayloads(frame).at(-1)?.markers?.[0]?.id, `entry:base:${ADDRESS_B}`);
});

test('a reused chart iframe rebinds across an SPA route without a load event', () => {
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });
  loaded.api.syncChartMarkers();
  loaded.api.runtime.state.positions[`base:${ADDRESS_B}`] = {
    chain: 'base', tokenAddress: ADDRESS_B, symbol: 'NEXT', quantity: 1,
    averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
  };
  const probesBeforeRoute = chartReadyProbes(frame).length;

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();

  assert.equal(chartReadyProbes(frame).length, probesBeforeRoute + 1,
    'route advance issues one fresh correlated probe without waiting for load');
  assert.deepEqual(markerPayloads(frame).at(-1), { markers: [] },
    'the reused frame is quarantined before B identity is established');
  const routeProbe = chartReadyProbes(frame).at(-1);
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY', probeId: `${routeProbe.probeId}:stale`,
      identity: chartReadyIdentity('base', ADDRESS_B) }
  });
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY', probeId: routeProbe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_A) }
  });
  assert.equal(loaded.calls.chartReady.length, 0,
    'untagged, mismatched-probe, and A-identified READY remain rejected');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY', probeId: routeProbe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_B) }
  });

  assert.deepEqual(loaded.calls.chartReady.at(-1)?.token, { chain: 'base', address: ADDRESS_B });
  assert.equal(markerPayloads(frame).at(-1)?.markers?.[0]?.id, `entry:base:${ADDRESS_B}`);
});

test('a registered chart frame safely rebinds after disappearing during route advance', () => {
  const frame = chartFrame();
  const frames = [frame];
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: frames
  });
  loaded.api.syncChartMarkers();
  loaded.api.runtime.state.positions[`base:${ADDRESS_B}`] = {
    chain: 'base', tokenAddress: ADDRESS_B, symbol: 'NEXT', quantity: 1,
    averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
  };

  frames.length = 0;
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();
  frame.messages.length = 0;

  frames.push(frame);
  loaded.api.syncChartMarkers(true);
  for (let index = 0; index < 5; index += 1) loaded.api.syncChartMarkers(true);

  assert.deepEqual(markerPayloads(frame), [{ markers: [] }],
    'the reappearing frame is quarantined instead of retaining its A overlay');
  assert.equal(chartReadyProbes(frame).length, 1,
    'the stale capture is rebound with exactly one fresh probe');
  const routeProbe = chartReadyProbes(frame)[0];
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: routeProbe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_A)
    }
  });
  assert.equal(loaded.calls.chartReady.length, 0,
    'identityless and A-identified READY cannot promote the rebound frame');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: routeProbe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_B)
    }
  });

  assert.deepEqual(loaded.calls.chartReady.at(-1)?.token, { chain: 'base', address: ADDRESS_B });
  assert.equal(markerPayloads(frame).at(-1)?.markers?.[0]?.id, `entry:base:${ADDRESS_B}`);
});

test('a first-seen transition B frame stays quarantined until correlated B identity promotes it', () => {
  const oldFrame = chartFrame();
  const frames = [oldFrame];
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: frames
  });

  loaded.api.syncChartMarkers();
  const newFrame = chartFrame();
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  frames.splice(0, 1, newFrame);
  loaded.api.handleRouteChange();
  assertOnlyUnscopedCleanup(newFrame,
    'a first-seen transition frame remains quarantined before independent identity evidence');
  const firstProbe = chartReadyProbes(newFrame).at(-1);
  assert.equal(typeof firstProbe?.probeId, 'string');

  loaded.api.dispatchWindowMessage({
    source: newFrame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  assert.equal(loaded.calls.chartReady.length, 0,
    'untagged READY timing alone cannot promote a transition frame');
  loaded.api.dispatchWindowMessage({
    source: newFrame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: firstProbe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_B)
    }
  });

  assert.deepEqual({
    readyBindings: loaded.calls.chartReady.length,
    invalidations: loaded.calls.chartInvalidations.length
  }, { readyBindings: 1, invalidations: 0 });
  assert.equal(loaded.calls.chartReady[0].frame, newFrame);
  assert.deepEqual(loaded.calls.chartReady[0].token, { chain: 'base', address: ADDRESS_B });
  assert.equal(markerPayloads(newFrame).at(-1).tokenAddress, ADDRESS_B,
    'matching child identity releases the current scoped payload');
});

test('mutation reconciliation quarantines a late A frame first observed after the parent URL is B', async () => {
  let observerCallback;
  const timers = [];
  const oldFrame = chartFrame();
  const frames = [oldFrame];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: frames,
    MutationObserver: CapturingMutationObserver
  });
  await loaded.api.start();
  loaded.api.runtime.state.positions[`base:${ADDRESS_B}`] = {
    chain: 'base', tokenAddress: ADDRESS_B, symbol: 'NEXT', quantity: 1,
    averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
  };

  const lateAFrame = chartFrame();
  frames.splice(0, 1, lateAFrame);
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  observerCallback([{
    target: { nodeType: 1, tagName: 'BODY' },
    addedNodes: [lateAFrame], removedNodes: [oldFrame]
  }]);

  assertOnlyUnscopedCleanup(lateAFrame,
    'the observer ordering cannot send B state before child verification');
  const probe = chartReadyProbes(lateAFrame).at(-1);
  loaded.api.dispatchWindowMessage({
    source: lateAFrame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: probe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_A)
    }
  });

  assert.equal(loaded.calls.chartReady.length, 0, 'late A identity cannot establish B trust');
  assertOnlyUnscopedCleanup(lateAFrame, 'late A remains quarantined after its mismatched response');
});

test('marker tick registration cannot let a late A frame be sealed to B on route advance', () => {
  const oldFrame = chartFrame();
  const frames = [oldFrame];
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: frames
  });
  loaded.api.syncChartMarkers();
  loaded.api.runtime.state.positions[`base:${ADDRESS_B}`] = {
    chain: 'base', tokenAddress: ADDRESS_B, symbol: 'NEXT', quantity: 1,
    averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
  };
  loaded.api.runtime.current = {
    ...quoteContext(ADDRESS_B),
    token: { ...quoteContext(ADDRESS_B).token, chain: 'base' }
  };

  const lateAFrame = chartFrame();
  frames.splice(0, 1, lateAFrame);
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.syncChartMarkers(true);
  loaded.api.handleRouteChange();

  assertOnlyUnscopedCleanup(lateAFrame,
    'pre-reconciliation marker registration remains quarantined after route advance');
  const probe = chartReadyProbes(lateAFrame).at(-1);
  loaded.api.dispatchWindowMessage({
    source: lateAFrame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: probe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_A)
    }
  });

  assert.equal(loaded.calls.chartReady.length, 0, 'route sealing cannot turn A evidence into B trust');
  assertOnlyUnscopedCleanup(lateAFrame, 'late A remains quarantined after route sealing');
});

test('adapter rejection keeps a child-identified transition frame quarantined', () => {
  const oldFrame = chartFrame();
  const frames = [oldFrame];
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: frames,
    markChartFrameReady: () => false
  });
  loaded.api.syncChartMarkers();

  const candidateB = chartFrame();
  frames.splice(0, 1, candidateB);
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();
  const probe = chartReadyProbes(candidateB).at(-1);
  loaded.api.dispatchWindowMessage({
    source: candidateB.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: probe.probeId,
      identity: chartReadyIdentity('base', ADDRESS_B)
    }
  });

  assertOnlyUnscopedCleanup(candidateB,
    'adapter trust rejection must leave the candidate quarantined');
});

test('startup registers the initial chart frame before its first asynchronous pause', async () => {
  const sessionGate = deferred();
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame],
    sendMessage: () => sessionGate.promise
  });
  const startPromise = loaded.api.start();

  try {
    frame.dispatch('load');
    assert.deepEqual(loaded.calls.chartInvalidations, [frame]);
    assert.deepEqual(markerPayloads(frame), [{ markers: [] }]);
  } finally {
    sessionGate.resolve({ suppressed: false });
    await startPromise;
  }
});

test('startup READY probe recovers trust when the child document-start READY was missed', async () => {
  const sessionGate = deferred();
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame],
    sendMessage: () => sessionGate.promise
  });
  const startPromise = loaded.api.start();

  try {
    assert.equal(loaded.calls.chartReady.length, 0, 'the discarded spontaneous READY established no trust');
    assert.equal(chartReadyProbes(frame).length, 1, 'startup probes before its first asynchronous pause');

    loaded.api.dispatchWindowMessage({
      source: frame.contentWindow,
      data: {
        source: 'TANGO_PAPER_CHART', type: 'READY',
        probeId: chartReadyProbes(frame)[0].probeId
      }
    });
    assert.equal(loaded.calls.chartReady.length, 1, 'the probe response recovers current-route trust');
    assert.deepEqual(loaded.calls.chartReady[0].token, { chain: 'base', address: ADDRESS_A });

    frame.dispatch('load');
    assert.deepEqual(loaded.calls.chartInvalidations, [frame], 'the recovered READY cannot bless a later document');
    assert.equal(chartReadyProbes(frame).length, 2, 'the later document receives its own load probe');
    assert.notEqual(chartReadyProbes(frame)[1].probeId, chartReadyProbes(frame)[0].probeId);
  } finally {
    sessionGate.resolve({ suppressed: false });
    await startPromise;
  }
});

test('same-route chart additions register before a later route can adopt them', async () => {
  let observerCallback;
  const timers = [];
  const firstFrame = chartFrame();
  const frames = [firstFrame];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: frames,
    MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  await loaded.api.start();

  const sameRouteFrame = chartFrame();
  frames.splice(0, 1, sameRouteFrame);
  observerCallback([{
    target: { nodeType: 1, tagName: 'BODY' },
    addedNodes: [sameRouteFrame],
    removedNodes: [firstFrame]
  }]);
  sameRouteFrame.dispatch('load');
  const loadReplayCount = markerPayloads(sameRouteFrame).length;

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();
  loaded.api.dispatchWindowMessage({
    source: sameRouteFrame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });

  assert.deepEqual({
    loadInvalidations: loaded.calls.chartInvalidations.length,
    delayedBReadyBindings: loaded.calls.chartReady.length,
    loadReplays: loadReplayCount
  }, { loadInvalidations: 1, delayedBReadyBindings: 0, loadReplays: 1 });
});

test('a current-route chart READY before load survives that load only once', () => {
  const frame = chartFrame();
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_B}`,
    chartFrames: [frame]
  });

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  assert.equal(loaded.calls.chartReady.length, 1);
  assert.equal(loaded.calls.chartReady[0].frame, frame);
  assert.deepEqual(loaded.calls.chartReady[0].token, { chain: 'base', address: ADDRESS_B });
  assert.deepEqual(markerPayloads(frame), [{ markers: [] }]);

  frame.dispatch('load');
  assert.deepEqual(loaded.calls.chartInvalidations, [], 'the matching document-start READY keeps trust');
  assert.deepEqual(markerPayloads(frame), [{ markers: [] }, { markers: [] }]);

  frame.dispatch('load');
  assert.deepEqual(loaded.calls.chartInvalidations, [frame], 'a later load without READY invalidates trust');
  assert.deepEqual(markerPayloads(frame), [{ markers: [] }, { markers: [] }, { markers: [] }]);
});

test('trench quick buy publishes its entry marker when detail-frame READY arrives before route discovery', async () => {
  const frame = chartFrame();
  const frames = [frame];
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=eth', chartFrames: frames });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  loaded.context.Tango.Store.executeBuy = async (order) => {
    const trade = {
      id: 'buy-trench', chain: 'eth', tokenAddress: ADDRESS_A, side: 'BUY',
      marketCapUsd: order.quote.marketCapUsd, observedPriceUsd: order.quote.priceUsd
    };
    return {
      state: {
        ...loaded.api.runtime.state,
        positions: {
          [`eth:${ADDRESS_A}`]: {
            chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'FAST', quantity: 1,
            averageEntryMarketCap: order.quote.marketCapUsd,
            averageEntryPriceUsd: order.quote.priceUsd
          }
        },
        trades: [trade]
      },
      trade
    };
  };

  await loaded.api.handleQuickBuy({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'FAST' },
    quote: {
      priceUsd: 2, marketCapUsd: 2_000, nativePriceUsd: 3_000,
      observedAt: loaded.clock.now, nativePriceObservedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    },
    amountNative: 1
  });
  assert.deepEqual(markerPayloads(frame).at(-1), { markers: [] });

  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_A}`;
  const detailFrame = chartFrame();
  frames.splice(0, 1, detailFrame);
  loaded.api.dispatchWindowMessage({
    source: detailFrame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });
  assert.deepEqual(markerPayloads(detailFrame).at(-1), { markers: [] });
  loaded.api.handleRouteChange();

  assertOnlyUnscopedCleanup(detailFrame, 'detail frame stays quarantined across parent route discovery');
  const routeProbe = chartReadyProbes(detailFrame).at(-1);
  assert.equal(typeof routeProbe?.probeId, 'string');
  loaded.api.dispatchWindowMessage({
    source: detailFrame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: routeProbe.probeId,
      identity: chartReadyIdentity('eth', ADDRESS_A)
    }
  });
  assert.deepEqual(loaded.calls.chartReady.at(-1).token, { chain: 'eth', address: ADDRESS_A });
  assert.equal(markerPayloads(detailFrame).at(-1).markers[0].id, `entry:eth:${ADDRESS_A}`);
});

test('a quick buy resolving after detail navigation replaces the early empty chart replay with its entry marker', async () => {
  const buyGate = deferred();
  const trenchFrame = chartFrame();
  const frames = [trenchFrame];
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=eth', chartFrames: frames });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  loaded.context.Tango.Store.executeBuy = () => buyGate.promise;

  const action = loaded.api.handleQuickBuy({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'FAST' },
    quote: {
      priceUsd: 2, marketCapUsd: 2_000, nativePriceUsd: 3_000,
      observedAt: loaded.clock.now, nativePriceObservedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    },
    amountNative: 1
  });
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_A}`;
  const detailFrame = chartFrame();
  frames.splice(0, 1, detailFrame);
  loaded.api.handleRouteChange();
  const routeProbe = chartReadyProbes(detailFrame).at(-1);
  loaded.api.dispatchWindowMessage({
    source: detailFrame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: routeProbe.probeId,
      identity: chartReadyIdentity('eth', ADDRESS_A)
    }
  });
  assert.deepEqual(markerPayloads(detailFrame).at(-1).markers, []);

  const trade = {
    id: 'buy-after-navigation', chain: 'eth', tokenAddress: ADDRESS_A, side: 'BUY',
    marketCapUsd: 2_000, observedPriceUsd: 2
  };
  buyGate.resolve({
    state: {
      ...loaded.api.runtime.state,
      positions: {
        [`eth:${ADDRESS_A}`]: {
          chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'FAST', quantity: 1,
          averageEntryMarketCap: 2_000, averageEntryPriceUsd: 2
        }
      },
      trades: [trade]
    },
    trade
  });
  await action;

  assert.equal(markerPayloads(detailFrame).at(-1).markers[0].id, `entry:eth:${ADDRESS_A}`);
});

test('detail buy and sell publish committed markers immediately', async () => {
  const frame = chartFrame();
  const loaded = loadContent({ chartFrames: [frame] });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  loaded.context.Tango.Store.executeBuy = async (order) => {
    const trade = {
      id: 'buy-direct', chain: 'eth', tokenAddress: ADDRESS_A, side: 'BUY',
      marketCapUsd: order.quote.marketCapUsd, observedPriceUsd: order.quote.priceUsd
    };
    return {
      state: {
        ...loaded.api.runtime.state,
        positions: {
          [`eth:${ADDRESS_A}`]: {
            chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 1,
            averageEntryMarketCap: order.quote.marketCapUsd,
            averageEntryPriceUsd: order.quote.priceUsd
          }
        },
        trades: [trade]
      },
      trade
    };
  };
  loaded.context.Tango.Store.executeSell = async (order) => {
    const trade = {
      id: 'sell-direct', chain: 'eth', tokenAddress: ADDRESS_A, side: 'SELL',
      marketCapUsd: order.quote.marketCapUsd, observedPriceUsd: order.quote.priceUsd
    };
    return {
      state: { ...loaded.api.runtime.state, trades: [...loaded.api.runtime.state.trades, trade] },
      trade
    };
  };

  await loaded.api.buy(1);
  assert.equal(markerPayloads(frame).at(-1).markers[0].id, `entry:eth:${ADDRESS_A}`);

  await loaded.api.sell(50);
  assert.equal(markerPayloads(frame).at(-1).markers.at(-1).id, `sell:eth:${ADDRESS_A}:sell-direct`);
});

test('chart READY replays the latest payload only to the ready frame', () => {
  const first = chartFrame();
  const second = chartFrame();
  const loaded = loadContent({ chartFrames: [first, second] });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1
  };
  loaded.api.syncChartMarkers();
  first.messages.length = 0;
  second.messages.length = 0;
  loaded.api.runtime.current = null;

  loaded.api.dispatchWindowMessage({
    source: second.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });

  assert.equal(markerPayloads(first).length, 0);
  assert.equal(markerPayloads(second).length, 1);
  assert.equal(markerPayloads(second)[0].markers[0].id, `entry:eth:${ADDRESS_A}`);
});

test('marker sync stores the current payload before any chart frame exists', () => {
  const frames = [];
  const loaded = loadContent({ chartFrames: frames });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1
  };

  loaded.api.syncChartMarkers();
  const frame = chartFrame();
  frames.push(frame);
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: { source: 'TANGO_PAPER_CHART', type: 'READY' }
  });

  assert.equal(markerPayloads(frame).at(-1)?.markers?.[0]?.id, `entry:eth:${ADDRESS_A}`);
});

test('a replaced chart frame replays the stored payload without waiting for state reconstruction', async () => {
  let observerCallback;
  const timers = [];
  const first = chartFrame();
  const frames = [first];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const loaded = loadContent({
    chartFrames: frames,
    readCurrentToken: async () => quoteContext(),
    MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  await loaded.api.start();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1
  };
  loaded.api.syncChartMarkers(true);
  loaded.api.runtime.current = null;

  const replacement = chartFrame();
  frames.splice(0, 1, replacement);
  observerCallback([{
    type: 'childList', target: { nodeType: 1, tagName: 'BODY' }, addedNodes: [replacement], removedNodes: [first]
  }]);
  timers.at(-1)();

  assert.equal(markerPayloads(replacement).length, 1);
  assert.equal(markerPayloads(replacement)[0].markers[0].id, `entry:eth:${ADDRESS_A}`);
});

test('the same chart iframe receives the latest marker payload again after its document loads', () => {
  const frame = chartFrame();
  const loaded = loadContent({ chartFrames: [frame] });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, averageEntryMarketCap: 1_000,
    averageEntryPriceUsd: 1, totalSupply: 1_000, supplySource: 'GMGN_EXACT'
  };
  loaded.api.syncChartMarkers();
  const beforeLoad = markerPayloads(frame).length;

  frame.dispatch('load');

  assert.equal(beforeLoad, 1);
  assert.deepEqual(markerPayloads(frame).at(-1), { markers: [] },
    'the new document generation is quarantined before its probe response');
  const probe = chartReadyProbes(frame).at(-1);
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART', type: 'READY', probeId: probe.probeId,
      identity: chartReadyIdentity('eth', ADDRESS_A)
    }
  });
  assert.equal(markerPayloads(frame).length, beforeLoad + 2);
  assert.equal(markerPayloads(frame).at(-1).markers[0].id, `entry:eth:${ADDRESS_A}`);
});

test('a factual same-token quote repositions provisional markers without rewriting executions', () => {
  const frame = chartFrame();
  const loaded = loadContent({ chartFrames: [frame] });
  const position = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 1,
    averageEntryMarketCap: 500, averageEntryPriceUsd: 0.0000005,
    valuationMode: 'MARKET_CAP', averageEntryPriceProvenance: 'MARKET_CAP_DERIVED'
  };
  const trade = {
    id: 'buy-provisional', chain: 'eth', tokenAddress: ADDRESS_A, side: 'BUY',
    marketCapUsd: 500, observedPriceUsd: 0.0000005, priceProvenance: 'MARKET_CAP_DERIVED'
  };
  loaded.api.runtime.current = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
    quote: {
      priceUsd: 0, marketCapUsd: 1_000, observedAt: loaded.clock.now,
      valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
    }
  };
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = position;
  loaded.api.runtime.state.trades = [trade];
  loaded.api.syncChartMarkers();
  const executionSnapshot = JSON.stringify({ position, trade });
  assert.equal(markerPayloads(frame).at(-1).markers[0].price, 0);

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'eth', address: ADDRESS_A, priceUsd: 2, marketCapUsd: 2_000,
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
    }]
  });

  assert.equal(markerPayloads(frame).at(-1).markers[0].price, 0.5);
  assert.equal(JSON.stringify({ position, trade }), executionSnapshot);
});

test('disabling publishes empty markers before dropping the current token', async () => {
  const frame = chartFrame();
  const disabled = { ...defaultSettings(), enabled: false };
  const loaded = loadContent({ chartFrames: [frame], getAll: () => ({ state: defaultState(), settings: disabled }) });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1
  };
  loaded.api.syncChartMarkers();
  assert.equal(markerPayloads(frame).at(-1).markers.length, 1);

  await loaded.api.performRefresh();

  assert.deepEqual(markerPayloads(frame).at(-1), { markers: [] });
  assert.equal(loaded.api.runtime.current, null);
});

test('a replacement chart frame added while disabled receives only the empty payload', async () => {
  let observerCallback;
  const timers = [];
  let settings = defaultSettings();
  const first = chartFrame();
  const frames = [first];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const loaded = loadContent({
    chartFrames: frames,
    getAll: () => ({ state: defaultState(), settings }),
    readCurrentToken: async () => quoteContext(),
    MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  await loaded.api.start();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1
  };
  loaded.api.syncChartMarkers(true);
  settings = { ...settings, enabled: false };
  await loaded.api.performRefresh();

  const replacement = chartFrame();
  frames.splice(0, 1, replacement);
  observerCallback([{
    type: 'childList', target: { nodeType: 1, tagName: 'BODY' }, addedNodes: [replacement], removedNodes: [first]
  }]);
  timers.at(-1)();

  assert.deepEqual(markerPayloads(replacement), [{ markers: [] }]);
});

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

function detailQuote(marketCapUsd, observedAt, address = ADDRESS_A) {
  return {
    chain: 'eth', address,
    priceUsd: marketCapUsd / 1_000_000_000, marketCapUsd,
    observedAt, priceObservedAt: observedAt, marketCapObservedAt: observedAt,
    source: 'GMGN', priceSource: 'GMGN', marketCapSource: 'GMGN',
    valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
}

function seedHeldDetailPosition(loaded, marketCapUsd = 3_750) {
  const quote = detailQuote(marketCapUsd, loaded.clock.now);
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.runtime.current = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
    quote: { ...quote }
  };
  loaded.api.runtime.gmgnQuotes.set(`eth:${ADDRESS_A}`, { ...quote });
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST',
    quantity: 1_000_000, costBasisNative: 1,
    averageEntryPriceUsd: quote.priceUsd, lastPriceUsd: quote.priceUsd,
    lastMarketCapUsd: marketCapUsd, lastNativePriceUsd: 3_000,
    quoteObservedAt: loaded.clock.now, valuationMode: 'PRICE'
  };
  return loaded.api.runtime.current;
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

test('first-install initialization refresh activates trench quick buy while the master switch stays on', async () => {
  let initialized = false;
  const settings = defaultSettings();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=bsc',
    getAll: () => ({
      state: { ...defaultState(), initialized },
      settings
    })
  });

  await loaded.api.performRefresh();
  loaded.pageMessages.length = 0;
  loaded.calls.discoverTokenCards = 0;
  initialized = true;

  await loaded.api.performRefresh();

  assert.ok(loaded.calls.discoverTokenCards >= 1);
  assert.equal(loaded.pageMessages.filter((message) => message.type === 'REQUEST_QUOTES').length, 1);
});

test('active language and preset refreshes rebuild quick buy without dropping the safety class', async () => {
  const presetSettings = defaultSettings();
  presetSettings.chains = {
    ...presetSettings.chains,
    base: { ...presetSettings.chains.base, buyPresets: [2] }
  };
  for (const { name, settings, expectedAmount } of [
    {
      name: 'language',
      settings: { ...defaultSettings(), language: 'zh-CN' },
      expectedAmount: 1
    },
    {
      name: 'preset',
      settings: presetSettings,
      expectedAmount: 2
    }
  ]) {
    const loaded = loadContent({
      href: 'https://gmgn.ai/?chain=base',
      getAll: () => ({ state: defaultState(), settings })
    });
    loaded.api.runtime.quickBuyMode = 'active';
    loaded.context.document.documentElement.classList.add('tango-paper-quick-buy-active');

    await loaded.api.performRefresh();

    assert.equal(loaded.calls.clearQuickBuy, 0, name);
    assert.equal(loaded.calls.discoverTokenCards, 1, name);
    assert.equal(
      loaded.context.document.documentElement.classList.contains('tango-paper-quick-buy-active'),
      true,
      name
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(loaded.calls.quickBuyEvents)),
      [{ type: 'discover', amountNative: expectedAmount, paperLabel: 'paper', safetyActive: true }],
      name
    );
  }
});

test('show-list false-to-true refresh enables safety before rebuilding quick buy', async () => {
  const settings = defaultSettings();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    getAll: () => ({ state: defaultState(), settings })
  });
  loaded.api.runtime.settings = { ...loaded.api.runtime.settings, showListQuickBuy: false };
  loaded.api.runtime.quickBuyMode = 'cleared';

  await loaded.api.performRefresh();

  assert.equal(loaded.calls.clearQuickBuy, 0);
  assert.equal(loaded.calls.discoverTokenCards, 1);
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-quick-buy-active'),
    true
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(loaded.calls.quickBuyEvents)),
    [{ type: 'discover', amountNative: 1, paperLabel: 'paper', safetyActive: true }]
  );
});

test('unknown startup state keeps native quick buy guarded and never restores a real-buy leaf', () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/r/X9cuc5jd?chain=bsc' });
  loaded.api.runtime.state = null;
  loaded.api.runtime.settings = null;
  loaded.api.runtime.quickBuyMode = 'unknown';

  loaded.api.syncQuickBuyButtons();

  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    false
  );
  assert.deepEqual(loaded.calls.clearQuickBuyRestore, [false]);
});

test('failed settings refresh cannot let a later mutation reactivate quick buy from stale settings', async () => {
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    getAll: () => { throw new Error('storage unavailable'); }
  });
  loaded.api.runtime.quickBuyMode = 'active';
  loaded.context.document.documentElement.classList.add('tango-paper-quick-buy-active');

  await assert.rejects(loaded.api.performRefresh(), /storage unavailable/);

  assert.equal(loaded.api.runtime.quickBuySettingsPending, true);
  assert.equal(loaded.api.runtime.quickBuyMode, 'guarded');
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-quick-buy-active'),
    false
  );
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    false
  );
  assert.deepEqual(loaded.calls.clearQuickBuyRestore, [false]);

  loaded.api.syncQuickBuyButtons();

  assert.equal(loaded.calls.discoverTokenCards, 0);
  assert.equal(loaded.api.runtime.quickBuyMode, 'guarded');
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-quick-buy-active'),
    false
  );
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    false
  );
  assert.deepEqual(loaded.calls.clearQuickBuyRestore, [false]);
});

test('successful settings refresh immediately rebuilds quick buy after a guarded read failure', async () => {
  let shouldFail = true;
  const settings = defaultSettings();
  const state = defaultState();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    getAll: () => {
      if (shouldFail) throw new Error('storage unavailable');
      return { state, settings };
    }
  });
  loaded.api.runtime.quickBuyMode = 'active';
  loaded.context.document.documentElement.classList.add('tango-paper-quick-buy-active');

  await assert.rejects(loaded.api.performRefresh(), /storage unavailable/);
  shouldFail = false;
  loaded.calls.discoverTokenCards = 0;

  await loaded.api.performRefresh();

  assert.equal(loaded.calls.discoverTokenCards, 1);
  assert.equal(loaded.api.runtime.quickBuyMode, 'active');
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-quick-buy-active'),
    true
  );
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    false
  );
});

test('a queued refresh failure stays inside the recoverable drain and schedules a guarded retry', async () => {
  const firstRead = deferred();
  const scheduled = [];
  let reads = 0;
  let secondReadFails = true;
  const state = defaultState();
  const settings = defaultSettings();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    logger: { error() {} },
    timer(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    getAll() {
      reads += 1;
      if (reads === 1) return firstRead.promise;
      if (secondReadFails) throw new Error('queued storage failure');
      return { state, settings };
    }
  });

  const firstRefresh = loaded.api.refreshRecoverably();
  const queuedRefresh = loaded.api.refreshRecoverably();
  assert.equal(reads, 1);
  firstRead.resolve({ state, settings });

  assert.deepEqual(await Promise.all([firstRefresh, queuedRefresh]), [false, false]);
  assert.equal(reads, 2);
  assert.equal(loaded.api.runtime.quickBuySettingsPending, true);
  assert.equal(loaded.api.runtime.quickBuyMode, 'guarded');
  const retry = scheduled.find(({ delay }) => delay === 500);
  assert.ok(retry, 'queued refresh failure must schedule a bounded retry');

  secondReadFails = false;
  await retry.callback();

  assert.equal(reads, 3);
  assert.equal(loaded.api.runtime.quickBuySettingsPending, false);
  assert.equal(loaded.api.runtime.quickBuyMode, 'active');
});

test('explicit OFF refresh removes quick-buy safety only when restoring trusted native controls', async () => {
  const settings = { ...defaultSettings(), enabled: false };
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    getAll: () => ({ state: defaultState(), settings })
  });
  loaded.api.runtime.quickBuyMode = 'active';
  loaded.context.document.documentElement.classList.add('tango-paper-quick-buy-active');

  await loaded.api.performRefresh();

  assert.equal(loaded.calls.discoverTokenCards, 0);
  assert.equal(loaded.calls.clearQuickBuy, 1);
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-quick-buy-active'),
    false
  );
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    true
  );
  assert.deepEqual(loaded.calls.clearQuickBuyRestore, [true]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(loaded.calls.quickBuyEvents)),
    [{ type: 'clear', safetyActive: false }]
  );
});

test('authoritative explicit OFF restores native controls before onboarding initializes', async () => {
  const state = { ...defaultState(), initialized: false };
  const settings = { ...defaultSettings(), enabled: false };
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    getAll: () => ({ state, settings })
  });
  loaded.api.runtime.quickBuyMode = 'active';
  loaded.context.document.documentElement.classList.add('tango-paper-quick-buy-active');

  await loaded.api.performRefresh();

  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    true
  );
  assert.deepEqual(loaded.calls.clearQuickBuyRestore, [true]);
});

test('list quick-buy OFF stays fail-closed while the paper-trading master remains ON', async () => {
  for (const initialized of [false, true]) {
    const state = { ...defaultState(), initialized };
    const settings = { ...defaultSettings(), showListQuickBuy: false };
    const loaded = loadContent({
      href: 'https://gmgn.ai/?chain=base',
      getAll: () => ({ state, settings })
    });
    loaded.api.runtime.quickBuyMode = 'active';
    loaded.context.document.documentElement.classList.add('tango-paper-quick-buy-active');

    await loaded.api.performRefresh();

    assert.equal(
      loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
      false,
      `initialized=${initialized}`
    );
    assert.deepEqual(loaded.calls.clearQuickBuyRestore, [false], `initialized=${initialized}`);
    assert.equal(loaded.api.runtime.quickBuyMode, 'guarded', `initialized=${initialized}`);
  }
});

test('content route reconciliation keeps BSC and Robinhood tab-scoped without selected-chain writes', async () => {
  const calls = { settingsPatches: [] };
  const shared = { state: defaultState(), settings: defaultSettings() };
  const loadTab = (href) => loadContent({
    href,
    getAll: () => shared,
    patchSettings: async (patch) => {
      calls.settingsPatches.push(patch);
      shared.settings = mergeSettingsPatch(shared.settings, patch);
      return shared.settings;
    }
  });
  const bsc = loadTab('https://gmgn.ai/?chain=bsc');
  const robinhood = loadTab('https://gmgn.ai/?chain=robinhood');

  await Promise.all([bsc.api.start(), robinhood.api.start()]);
  await Promise.all([bsc.api.performRefresh(), robinhood.api.performRefresh()]);
  bsc.context.location.href = 'https://gmgn.ai/?chain=bsc&tab=portfolio';
  robinhood.context.location.href = 'https://gmgn.ai/?chain=robinhood&tab=portfolio';
  bsc.api.handleRouteChange();
  robinhood.api.handleRouteChange();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    calls.settingsPatches.filter((patch) => Object.hasOwn(patch, 'selectedChain')),
    []
  );
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

async function mutationLaneScenario() {
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
  loaded.context.Tango.GMGN.discoverTokenCards = (...args) => {
    discoveries.push({ roots: args[3], options: args[4] });
    return 0;
  };
  await loaded.api.start();
  return { loaded, observerCallback, timers, discoveries };
}

function tokenItemRoot({ address = ADDRESS_A } = {}) {
  return {
    nodeType: 1,
    isConnected: true,
    tagName: 'DIV',
    address,
    matches: (selector) => selector === '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]',
    querySelectorAll: () => []
  };
}

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
  assert.equal(discoveries[0].roots.length, 1);
  assert.equal(discoveries[0].roots[0], card);
  assert.equal(discoveries[0].options.fast, true);
  assert.equal(discoveries[0].options.addedRoots.length, 1);
  assert.equal(discoveries[0].options.addedRoots[0], card);
  assert.equal(timers.length, beforeTimers + 1);

  timers[beforeTimers]();
  assert.equal(discoveries.length, 2);
  assert.equal(discoveries[1].options.fast, false);
});

test('an added React wrapper discovers its TokenItem descendant in the same observer turn', async () => {
  const { loaded, observerCallback, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();
  const wrapper = {
    nodeType: 1, tagName: 'DIV', matches: () => false, closest: () => null,
    querySelector: (selector) => selector.includes('TokenItem.tsx') ? card : null,
    querySelectorAll: (selector) => selector.includes('TokenItem.tsx') ? [card] : []
  };
  loaded.context.document.body.querySelector = () => { throw new Error('document scan'); };
  loaded.context.document.body.querySelectorAll = () => { throw new Error('document scan'); };

  observerCallback([{
    type: 'childList', target: loaded.context.document.body,
    addedNodes: [wrapper], removedNodes: []
  }]);

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].roots.length, 1);
  assert.equal(discoveries[0].roots[0], card);
  assert.equal(discoveries[0].options.fast, true);
  assert.equal(discoveries[0].options.addedRoots.length, 1);
  assert.equal(discoveries[0].options.addedRoots[0], wrapper);
});

test('one added React wrapper discovers every TokenItem descendant without a document scan', async () => {
  const { loaded, observerCallback, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const first = tokenItemRoot({ address: ADDRESS_A });
  const second = tokenItemRoot({ address: ADDRESS_B });
  const card = (id) => ({
    nodeType: 1, tagName: 'DIV', id,
    matches: (selector) => selector === '[class~="group/a"]', querySelectorAll: () => []
  });
  const slot = (id) => ({
    nodeType: 1, tagName: 'DIV', id,
    matches: (selector) => selector === '.BuyButton-continer', querySelectorAll: () => []
  });
  const wrapper = {
    nodeType: 1, tagName: 'DIV', matches: () => false, closest: () => null,
    querySelectorAll(selector) {
      if (selector === '[data-sentry-element="SimulateLinkByConfig"][data-sentry-source-file="TokenItem.tsx"]') return [first, second];
      if (selector === '[class~="group/a"]') return [card('first-card'), card('second-card')];
      if (selector === '.BuyButton-continer') return [slot('first-slot'), slot('second-slot')];
      return [];
    }
  };
  loaded.context.document.body.querySelectorAll = () => { throw new Error('document scan'); };

  observerCallback([{
    type: 'childList', target: loaded.context.document.body,
    addedNodes: [wrapper], removedNodes: []
  }]);

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].options.fast, true);
  assert.equal(discoveries[0].roots.length, 2);
  assert.equal(discoveries[0].roots[0], first);
  assert.equal(discoveries[0].roots[1], second);
  assert.equal(discoveries[0].options.addedRoots.length, 1);
  assert.equal(discoveries[0].options.addedRoots[0], wrapper);
});

test('an added TokenItem remains the only discovery root when it contains a card and slot', async () => {
  const { loaded, observerCallback, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const item = tokenItemRoot();
  const card = {
    nodeType: 1, tagName: 'DIV', matches: (selector) => selector === '[class~="group/a"]'
  };
  const slot = {
    nodeType: 1, tagName: 'DIV', matches: (selector) => selector === '.BuyButton-continer'
  };
  item.querySelectorAll = (selector) => {
    if (selector === '[class~="group/a"]') return [card];
    if (selector === '.BuyButton-continer') return [slot];
    return [];
  };

  observerCallback([{
    type: 'childList', target: loaded.context.document.body,
    addedNodes: [item], removedNodes: []
  }]);

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].roots.length, 1);
  assert.equal(discoveries[0].roots[0], item);
});

test('BODY mutation targets never become synchronous quick-buy discovery roots', async () => {
  const { observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();
  const body = { nodeType: 1, tagName: 'BODY', querySelectorAll() { throw new Error('page scan'); } };
  const beforeTimers = timers.length;

  observerCallback([{ type: 'childList', target: body, addedNodes: [card], removedNodes: [] }]);

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].roots.length, 1);
  assert.equal(discoveries[0].roots[0], card);
  assert.equal(timers.length, beforeTimers + 1);
});

test('paper quick-buy mutations stay out of both immediate and deferred discovery', async () => {
  const { observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();
  const paperControl = {
    nodeType: 1, tagName: 'BUTTON',
    matches: (selector) => selector === '.tango-list-quick-buy',
    closest: (selector) => selector.includes('TokenItem.tsx') || selector.includes('[class~="group/a"]')
      ? card : null
  };
  const paperChild = {
    nodeType: 1, tagName: 'SPAN', matches: () => false,
    closest: (selector) => selector === '.tango-list-quick-buy' ? paperControl : card
  };
  const beforeTimers = timers.length;

  observerCallback([
    { type: 'attributes', attributeName: 'style', target: paperControl, addedNodes: [], removedNodes: [] },
    { type: 'attributes', attributeName: 'class', target: paperControl, addedNodes: [], removedNodes: [] },
    { type: 'childList', target: paperControl, addedNodes: [paperChild], removedNodes: [] }
  ]);

  assert.equal(discoveries.length, 0);
  assert.equal(timers.length, beforeTimers);
});

test('paper control replaceWith mutations at a quick-buy slot create no discovery or timer', async () => {
  const { observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();
  const slot = {
    nodeType: 1, tagName: 'DIV', matches: (selector) => selector === '.BuyButton-continer',
    closest: (selector) => selector === '[class~="group/a"]' ? card : null
  };
  const paper = {
    nodeType: 1, tagName: 'BUTTON',
    matches: (selector) => selector === '.tango-list-quick-buy',
    closest: (selector) => selector === '.tango-list-quick-buy' ? paper : slot
  };
  const native = {
    nodeType: 1, tagName: 'BUTTON',
    matches: (selector) => selector === 'button, [role="button"], a[href], [data-testid="quickbuy"]',
    closest: (selector) => selector === '.BuyButton-continer'
      ? slot : (selector === '[class~="group/a"]' ? card : null)
  };
  const beforeTimers = timers.length;

  observerCallback([{
    type: 'childList', target: slot, addedNodes: [paper], removedNodes: [native]
  }]);

  assert.equal(discoveries.length, 0);
  assert.equal(timers.length, beforeTimers);
});

test('unrelated page class style and text mutations stay out of the fast discovery lane', async () => {
  const { observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const unrelated = { nodeType: 1, tagName: 'DIV', matches: () => false, closest: () => null };
  const text = { nodeType: 3, parentElement: unrelated };
  const beforeTimers = timers.length;

  observerCallback([
    { type: 'attributes', attributeName: 'class', target: unrelated, addedNodes: [], removedNodes: [] },
    { type: 'attributes', attributeName: 'style', target: unrelated, addedNodes: [], removedNodes: [] },
    { type: 'characterData', target: text, addedNodes: [], removedNodes: [] }
  ]);

  assert.equal(discoveries.length, 0);
  assert.equal(timers.length, beforeTimers);
});

test('a dynamically added header wrapper queues maintenance and attaches the paper balance', async () => {
  const { loaded, observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  loaded.api.runtime.state.accounts.eth.cashBalanceNative = 7;
  const anchor = loaded.createDomNode();
  loaded.documentSingles.set('[data-testid="wallet-connected"]', anchor);
  const wrapper = {
    nodeType: 1, tagName: 'DIV', matches: () => false, closest: () => null,
    querySelector: (selector) => selector === '[data-testid="wallet-connected"]' ? anchor : null
  };
  const beforeTimers = timers.length;

  observerCallback([{
    type: 'childList', target: loaded.context.document.body, addedNodes: [wrapper], removedNodes: []
  }]);

  assert.equal(discoveries.length, 0);
  assert.equal(timers.length, beforeTimers + 1);
  timers[beforeTimers]();
  assert.equal(loaded.documentSingles.get('#tango-header-account-summary')?.parentElement, anchor);
});

test('a wrapper containing a chart frame queues chart maintenance', async () => {
  const { loaded, observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const wrapper = {
    nodeType: 1, tagName: 'DIV', matches: () => false, closest: () => null,
    querySelector: (selector) => selector.includes('iframe[title="Financial Chart"]')
      ? { nodeType: 1, tagName: 'IFRAME', contentWindow: {} } : null
  };
  const beforeTimers = timers.length;

  observerCallback([{
    type: 'childList', target: loaded.context.document.body, addedNodes: [wrapper], removedNodes: []
  }]);

  assert.equal(discoveries.length, 0);
  assert.equal(timers.length, beforeTimers + 1);
});

test('card price and countdown child replacements create no discovery or timer', async () => {
  const { observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();
  const price = { nodeType: 1, tagName: 'SPAN', matches: () => false, closest: () => card };
  const countdown = { nodeType: 1, tagName: 'SPAN', matches: () => false, closest: () => card };
  const beforeTimers = timers.length;

  observerCallback([{
    type: 'childList', target: card, addedNodes: [price], removedNodes: [countdown]
  }]);

  assert.equal(discoveries.length, 0);
  assert.equal(timers.length, beforeTimers);
});

test('a native quick-buy control inserted or reinserted inside its slot stays fast', async () => {
  const { observerCallback, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();
  const slot = {
    nodeType: 1, tagName: 'DIV', matches: (selector) => selector === '.BuyButton-continer',
    closest: (selector) => selector === '[class~="group/a"]' ? card : null
  };
  const native = {
    nodeType: 1, tagName: 'BUTTON', matches: (selector) => selector === 'button, [role="button"], a[href], [data-testid="quickbuy"]',
    closest: (selector) => selector === '.BuyButton-continer'
      ? slot : (selector === '[class~="group/a"]' ? card : null)
  };

  observerCallback([{
    type: 'childList', target: slot, addedNodes: [native], removedNodes: [native]
  }]);

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].options.fast, true);
  assert.equal(discoveries[0].roots.length, 1);
  assert.equal(discoveries[0].roots[0], slot);
});

test('external quick-buy card mutations defer one maintenance discovery without entering fast lane', async () => {
  const { observerCallback, timers, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();
  const cardChild = {
    nodeType: 1, tagName: 'SPAN', matches: () => false,
    closest: (selector) => selector === '.tango-list-quick-buy' ? null : card
  };
  const slot = {
    nodeType: 1, tagName: 'DIV', matches: (selector) => selector === '.BuyButton-continer',
    closest: (selector) => selector === '.tango-list-quick-buy' ? null : card
  };
  const text = { nodeType: 3, parentElement: cardChild };
  const beforeTimers = timers.length;

  observerCallback([
    { type: 'attributes', attributeName: 'class', target: card, addedNodes: [], removedNodes: [] },
    { type: 'attributes', attributeName: 'style', target: cardChild, addedNodes: [], removedNodes: [] },
    { type: 'attributes', attributeName: 'data-testid', target: slot, addedNodes: [], removedNodes: [] },
    { type: 'characterData', target: text, addedNodes: [], removedNodes: [] }
  ]);

  assert.equal(discoveries.length, 0);
  timers[beforeTimers]();
  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].options.fast, false);
});

test('new TokenItem child and its first href mutation stay in the same fast observer turn', async () => {
  const { loaded, observerCallback, discoveries } = await mutationLaneScenario();
  discoveries.length = 0;
  const card = tokenItemRoot();

  observerCallback([
    { type: 'childList', target: loaded.context.document.body, addedNodes: [card], removedNodes: [] },
    { type: 'attributes', attributeName: 'href', oldValue: null, target: card, addedNodes: [], removedNodes: [] }
  ]);

  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].roots.length, 1);
  assert.equal(discoveries[0].roots[0], card);
  assert.equal(discoveries[0].options.fast, true);
  assert.equal(discoveries[0].options.addedRoots[0], card);
  assert.equal(discoveries[0].options.hrefMutations.length, 1);
  assert.equal(discoveries[0].options.hrefMutations[0].oldValue, null);
  assert.equal(discoveries[0].options.hrefMutations[0].target.address, ADDRESS_A);
});

test('an addressless TokenItem root publishes a resolving-identity paper action before maintenance', async () => {
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver
  };
  let observerCallback;
  const timers = [];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const harness = mutationQuickBuyHarness('', { tokenItem: true });
  let visible = false;
  const originalQuery = harness.document.querySelectorAll;
  harness.document.querySelectorAll = (selector) => selector === '.BuyButton-continer'
    ? (visible ? [harness.slot] : []) : originalQuery(selector);
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base', MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  loaded.context.Tango.GMGN.discoverTokenCards = (...args) => RealGMGN.discoverTokenCards(...args);
  try {
    await loaded.api.start();
    visible = true;
    const beforeTimers = timers.length;
    observerCallback([{
      type: 'childList', target: loaded.context.document.body,
      addedNodes: [harness.card], removedNodes: []
    }]);

    assert.equal(timers.length, beforeTimers + 1);
    assert.equal(harness.paperControlCount, 1);
    assert.equal(harness.replacement.disabled, false);
    assert.equal(harness.replacement.dataset.tangoPaperState, 'resolving-identity');
    assert.ok(harness.slot.dataset.tangoActionId);
    assert.ok(harness.slot.dataset.tangoBindingNonce);
    assert.equal(harness.nativeControl.isConnected, false);
  } finally {
    RealGMGN.clearQuickBuy();
    Object.assign(global, original);
  }
});

test('a real TokenItem removal invalidates its birth before same-node reinsertion', async () => {
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver
  };
  let observerCallback;
  const timers = [];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const harness = mutationQuickBuyHarness('', { tokenItem: true });
  let visible = false;
  const originalQuery = harness.document.querySelectorAll;
  harness.document.querySelectorAll = (selector) => selector === '.BuyButton-continer'
    ? (visible ? [harness.slot] : []) : originalQuery(selector);
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base', MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  loaded.context.Tango.GMGN.discoverTokenCards = (...args) => RealGMGN.discoverTokenCards(...args);
  try {
    await loaded.api.start();
    visible = true;
    observerCallback([{ type: 'childList', target: loaded.context.document.body, addedNodes: [harness.card], removedNodes: [] }]);
    assert.equal(RealGMGN._quickBuyBirthForRoot(harness.card)?.eligible, true);

    harness.card.isConnected = false;
    harness.slot.isConnected = false;
    observerCallback([{ type: 'childList', target: loaded.context.document.body, addedNodes: [], removedNodes: [harness.card] }]);
    harness.card.isConnected = true;
    harness.slot.isConnected = true;
    observerCallback([{ type: 'childList', target: loaded.context.document.body, addedNodes: [harness.card], removedNodes: [] }]);

    assert.equal(RealGMGN._quickBuyBirthForRoot(harness.card)?.eligible, false);
  } finally {
    RealGMGN.clearQuickBuy();
    Object.assign(global, original);
  }
});

test('same-batch TokenItem removal invalidates a birth even after React reinserts it', async () => {
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver
  };
  let observerCallback;
  const timers = [];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }
  const harness = mutationQuickBuyHarness('', { tokenItem: true });
  let visible = false;
  const originalQuery = harness.document.querySelectorAll;
  harness.document.querySelectorAll = (selector) => selector === '.BuyButton-continer'
    ? (visible ? [harness.slot] : []) : originalQuery(selector);
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base', MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  loaded.context.Tango.GMGN.discoverTokenCards = (...args) => RealGMGN.discoverTokenCards(...args);
  try {
    await loaded.api.start();
    visible = true;
    observerCallback([{ type: 'childList', target: loaded.context.document.body, addedNodes: [harness.card], removedNodes: [] }]);
    assert.equal(RealGMGN._quickBuyBirthForRoot(harness.card)?.eligible, true);

    observerCallback([{
      type: 'childList', target: loaded.context.document.body,
      removedNodes: [harness.card], addedNodes: [harness.card]
    }]);

    assert.equal(RealGMGN._quickBuyBirthForRoot(harness.card)?.eligible, false);
  } finally {
    RealGMGN.clearQuickBuy();
    Object.assign(global, original);
  }
});

async function mutationProvenanceScenario() {
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver
  };
  let observerCallback;
  let observerOptions;
  const timers = [];
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe(_target, options) { observerOptions = options; }
  }
  const harness = mutationQuickBuyHarness('', { tokenItem: true });
  let visible = false;
  const originalQuery = harness.document.querySelectorAll;
  harness.document.querySelectorAll = (selector) => selector === '.BuyButton-continer'
    ? (visible ? [harness.slot] : []) : originalQuery(selector);
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base', MutationObserver: CapturingMutationObserver,
    timer(callback) { timers.push(callback); return timers.length; }
  });
  const paperOrders = [];
  const paperAssets = {
    cash: 4_242,
    positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
    trades: [{ id: 'sentinel-trade', side: 'BUY' }],
    markers: [{ id: 'sentinel-marker', price: 11 }]
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  loaded.context.Tango.GMGN.discoverTokenCards = (onQuickBuy, ...args) => RealGMGN.discoverTokenCards((order) => {
    paperOrders.push(order);
    paperAssets.cash -= Number(order?.amountNative || 0);
    paperAssets.positions.push({
      chain: order?.token?.chain, address: order?.token?.address, quantity: 1
    });
    paperAssets.trades.push({ id: order?.actionId, side: 'BUY' });
    paperAssets.markers.push({ id: order?.actionId, price: order?.quote?.priceUsd || 0 });
    return onQuickBuy(order);
  }, ...args);
  await loaded.api.start();
  visible = true;
  return {
    loaded, harness, paperOrders, paperAssets, timers,
    observer(records) { observerCallback(records); },
    get observerOptions() { return observerOptions; },
    async clickResolvingShell(expectedIntents = 1) {
      const paper = harness.replacement;
      assert.equal(paper?.disabled, false);
      RealGMGN._invokeQuickBuyAction(
        paper.dataset.tangoActionId,
        paper.dataset.tangoBindingNonce,
        'PAPER_QUICK_BUY_INTENT'
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(RealGMGN._quickBuyIntentCount(), expectedIntents);
    },
    async flush() { await new Promise((resolve) => setImmediate(resolve)); },
    cleanup() {
      RealGMGN.clearQuickBuy();
      Object.assign(global, original);
    }
  };
}

const SENTINEL_PAPER_ASSETS = {
  cash: 4_242,
  positions: [{ chain: 'base', address: 'sentinel-position', quantity: 7 }],
  trades: [{ id: 'sentinel-trade', side: 'BUY' }],
  markers: [{ id: 'sentinel-marker', price: 11 }]
};

test('fresh add remove reinsert provenance keeps a clickable shell but cannot auto-claim an intent', async () => {
  const scenario = await mutationProvenanceScenario();
  try {
    scenario.observer([
      { type: 'childList', target: scenario.loaded.context.document.body, addedNodes: [scenario.harness.card], removedNodes: [] },
      { type: 'childList', target: scenario.loaded.context.document.body, addedNodes: [], removedNodes: [scenario.harness.card] },
      { type: 'childList', target: scenario.loaded.context.document.body, addedNodes: [scenario.harness.card], removedNodes: [] }
    ]);
    assert.equal(scenario.harness.paperControlCount, 1);
    assert.equal(scenario.harness.replacement.disabled, false);
    await scenario.clickResolvingShell(0);

    scenario.harness.setAddress(ADDRESS_A);
    scenario.observer([{
      type: 'attributes', attributeName: 'href', oldValue: null,
      target: scenario.harness.card, addedNodes: [], removedNodes: []
    }]);
    await scenario.flush();

    assert.equal(RealGMGN._quickBuyBirthForRoot(scenario.harness.card)?.eligible, false);
    assert.equal(scenario.paperOrders.length, 0);
    assert.deepEqual(scenario.paperAssets, SENTINEL_PAPER_ASSETS);
    assert.equal(scenario.harness.nativeControl.captureCalls, 0);
    assert.equal(scenario.harness.nativeControl.bubbleCalls, 0);
    assert.equal(scenario.harness.nativeControl.realHandlerCalls, 0);
  } finally {
    scenario.cleanup();
  }
});

test('valid href removal and restoration in one ordered oldValue batch cannot auto-consume an intent', async () => {
  const scenario = await mutationProvenanceScenario();
  const href = `https://gmgn.ai/base/token/${ADDRESS_A}`;
  try {
    scenario.observer([{
      type: 'childList', target: scenario.loaded.context.document.body,
      addedNodes: [scenario.harness.card], removedNodes: []
    }]);
    await scenario.clickResolvingShell();

    scenario.harness.setAddress(ADDRESS_A);
    scenario.observer([
      { type: 'attributes', attributeName: 'href', oldValue: null, target: scenario.harness.card, addedNodes: [], removedNodes: [] },
      { type: 'attributes', attributeName: 'href', oldValue: href, target: scenario.harness.card, addedNodes: [], removedNodes: [] },
      { type: 'attributes', attributeName: 'href', oldValue: null, target: scenario.harness.card, addedNodes: [], removedNodes: [] }
    ]);
    await scenario.flush();

    assert.equal(RealGMGN._quickBuyBirthForRoot(scenario.harness.card)?.eligible, false);
    assert.equal(scenario.paperOrders.length, 0);
    assert.deepEqual(scenario.paperAssets, SENTINEL_PAPER_ASSETS);
    assert.equal(scenario.harness.replacement.disabled, false);
    assert.equal(scenario.harness.nativeControl.captureCalls, 0);
    assert.equal(scenario.harness.nativeControl.bubbleCalls, 0);
    assert.equal(scenario.harness.nativeControl.realHandlerCalls, 0);
    assert.equal(scenario.observerOptions.attributeOldValue, true);
  } finally {
    scenario.cleanup();
  }
});

test('one first valid href record promotes an eligible addressless birth without native callbacks', async () => {
  const scenario = await mutationProvenanceScenario();
  try {
    scenario.observer([{
      type: 'childList', target: scenario.loaded.context.document.body,
      addedNodes: [scenario.harness.card], removedNodes: []
    }]);
    await scenario.clickResolvingShell();

    scenario.harness.setAddress(ADDRESS_A);
    scenario.observer([{
      type: 'attributes', attributeName: 'href', oldValue: null,
      target: scenario.harness.card, addedNodes: [], removedNodes: []
    }]);
    await scenario.flush();

    assert.equal(RealGMGN._quickBuyIntentCount(), 0);
    assert.equal(RealGMGN._quickBuyBirthForRoot(scenario.harness.card)?.eligible, true);
    assert.equal(scenario.harness.slot.__tangoQuickBuyBinding?.state, 'ready');
    assert.equal(scenario.harness.nativeControl.captureCalls, 0);
    assert.equal(scenario.harness.nativeControl.bubbleCalls, 0);
    assert.equal(scenario.harness.nativeControl.realHandlerCalls, 0);
  } finally {
    scenario.cleanup();
  }
});

test('startup observes the first trench render before the initial token read', async () => {
  let observerReady = false;
  class CapturingMutationObserver {
    constructor() { observerReady = true; }
    observe() {}
  }
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    MutationObserver: CapturingMutationObserver,
    readCurrentToken: () => {
      assert.equal(observerReady, true);
      return null;
    }
  });

  await loaded.api.start();
});

test('startup observes the first trench render before loading persisted paper state', async () => {
  let observerReady = false;
  class CapturingMutationObserver {
    constructor() { observerReady = true; }
    observe() {}
  }
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=base',
    MutationObserver: CapturingMutationObserver,
    getAll: () => {
      assert.equal(observerReady, true);
      return { state: defaultState(), settings: defaultSettings() };
    }
  });

  await loaded.api.start();
});

test('startup stays guarded and automatically retries a transient first storage read failure', async () => {
  const scheduled = [];
  let reads = 0;
  const state = defaultState();
  const settings = defaultSettings();
  const loaded = loadContent({
    href: 'https://gmgn.ai/r/X9cuc5jd?chain=bsc',
    logger: { error() {} },
    timer(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    getAll() {
      reads += 1;
      if (reads === 1) throw new Error('storage unavailable');
      return { state, settings };
    }
  });
  loaded.api.runtime.state = null;
  loaded.api.runtime.settings = null;
  loaded.api.runtime.quickBuyMode = 'unknown';

  await loaded.api.start();

  assert.equal(reads, 1);
  assert.equal(loaded.api.runtime.quickBuySettingsPending, true);
  assert.equal(loaded.api.runtime.quickBuyMode, 'guarded');
  assert.equal(loaded.calls.discoverTokenCards, 0);
  assert.equal(typeof loaded.calls.storeSubscriber, 'function');
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    false
  );
  const retry = scheduled.find(({ delay }) => delay === 500);
  assert.ok(retry, 'startup must schedule a bounded storage retry');

  await retry.callback();

  assert.equal(reads, 2);
  assert.equal(loaded.api.runtime.quickBuySettingsPending, false);
  assert.equal(loaded.api.runtime.quickBuyMode, 'active');
  assert.ok(loaded.calls.discoverTokenCards >= 1);
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-quick-buy-active'),
    true
  );
  assert.equal(
    loaded.context.document.documentElement.classList.contains('tango-paper-native-quick-buy-allowed'),
    false
  );
});

test('local master OFF synchronously blocks stale paper execution while settings refresh is unresolved', async () => {
  const refreshGate = deferred();
  const state = defaultState();
  const enabledSettings = {
    ...defaultSettings(), fastMode: true, confirmationEnabled: false
  };
  const disabledSettings = { ...enabledSettings, enabled: false };
  let reads = 0;
  const loaded = loadContent({
    getAll() {
      reads += 1;
      return reads === 1
        ? { state, settings: enabledSettings }
        : refreshGate.promise;
    }
  });

  await loaded.api.start();
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  assert.equal(loaded.api.runtime.quickBuySettingsPending, false);
  assert.equal(loaded.api.runtime.quickBuyAuthoritativelyDisabled, false);

  loaded.dispatchStorageChange({
    [global.Tango.SETTINGS_KEY]: {
      oldValue: enabledSettings,
      newValue: disabledSettings
    }
  });

  assert.equal(loaded.api.runtime.quickBuySettingsPending, true);
  assert.equal(loaded.api.runtime.quickBuyAuthoritativelyDisabled, true);
  const refresh = loaded.calls.storeSubscriber();
  assert.equal(reads, 2);

  await loaded.api.handleQuickBuy({
    ...quoteContext(), actionId: 'stale-paper-action', amountNative: 1
  });
  assert.equal(loaded.api.runtime.quickBuyLocks.size, 0);
  assert.equal(loaded.calls.buy, 0);

  refreshGate.resolve({ state, settings: disabledSettings });
  await refresh;
  assert.equal(loaded.api.runtime.quickBuySettingsPending, false);
  assert.equal(loaded.api.runtime.quickBuyAuthoritativelyDisabled, true);
  assert.equal(loaded.api.runtime.settings.enabled, false);
  assert.equal(loaded.api.runtime.quickBuyLocks.size, 0);
  assert.equal(loaded.calls.buy, 0);
});

test('local master OFF prevents an already-open paper buy confirmation from committing', async () => {
  const loaded = loadContent();
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  await loaded.api.buy(1, quoteContext());
  assert.equal(loaded.api.runtime.modal?.type, 'confirm');
  assert.equal(loaded.calls.buy, 0);

  loaded.dispatchStorageChange({
    [global.Tango.SETTINGS_KEY]: {
      oldValue: defaultSettings(),
      newValue: { ...defaultSettings(), enabled: false }
    }
  });
  await loaded.api.runtime.modal.action();

  assert.equal(loaded.calls.buy, 0);
  assert.equal(loaded.api.runtime.tradePending, false);
});

test('startup immediately installs a clickable resolving-identity paper shell for a staged first trench card', async () => {
  const original = {
    document: global.document, location: global.location, raf: global.requestAnimationFrame,
    ResizeObserver: global.ResizeObserver
  };
  const harness = mutationQuickBuyHarness();
  harness.setAddress('');
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=base' });
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  loaded.context.Tango.GMGN.discoverTokenCards = (...args) => RealGMGN.discoverTokenCards(...args);
  try {
    await loaded.api.start();

    assert.ok(harness.replacement);
    assert.equal(harness.replacement.disabled, false);
    assert.equal(harness.replacement.dataset.tangoPaperState, 'resolving-identity');
    assert.equal(typeof harness.slot.__tangoQuickBuyHandler, 'function');
    assert.ok(harness.slot.dataset.tangoActionId);
    assert.ok(harness.slot.dataset.tangoBindingNonce);
    assert.equal(harness.nativeControl.isConnected, false);
  } finally {
    RealGMGN.clearQuickBuy();
    Object.assign(global, original);
  }
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
    assert.deepEqual(observed, [
      harness.slot, firstControl, harness.card,
      harness.slot, harness.replacement, harness.card
    ]);
    assert.deepEqual(unobserved, [harness.slot, firstControl, harness.card]);
    assert.equal(disconnects, 1);
    assert.equal(harness.nativeControl.restored, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(observerOptions)), {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['href', 'class', 'style', 'data-testid'], attributeOldValue: true,
      characterData: true
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
      assert.equal(timers.length, timerIndex);
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

test('valid-address quick and detail buys commit the six-chain no-market fallback matrix', async () => {
  const chains = [
    ['sol', SOL_ADDRESS], ['eth', ADDRESS_A], ['bsc', ADDRESS_A],
    ['base', ADDRESS_A], ['robinhood', ADDRESS_A], ['xlayer', ADDRESS_A]
  ];
  const rejectedReasons = new Set([
    'nativePriceUnavailable', 'staleQuote', 'invalidQuote', 'invalidArithmetic', 'realTimePrice'
  ]);
  for (const [chain, address] of chains) {
    for (const context of ['quick', 'detail']) {
      const loaded = loadContent({
        href: `https://gmgn.ai/${chain}/token/${address}`,
        sendMessage: () => new Promise(() => {})
      });
      loaded.api.runtime.settings.fastMode = true;
      loaded.api.runtime.settings.confirmationEnabled = false;
      const token = { chain, address };
      const initial = RealState.createInitialState({
        now: 1, initialBalances: { [chain]: 10 }
      });
      initial.initialized = true;
      const settings = RealState.normalizeSettings({
        slippageBps: 0,
        platformFeeBps: 0,
        chains: { [chain]: { networkFeeNative: 0 } }
      });
      const values = {
        [global.Tango.STORAGE_KEY]: structuredClone(initial),
        [global.Tango.SETTINGS_KEY]: structuredClone(settings)
      };
      const coordinator = StateCoordinator.create({
        async readRaw(keys) {
          return Object.fromEntries(keys.filter((key) => key in values)
            .map((key) => [key, structuredClone(values[key])]));
        },
        async writeRaw(next) { Object.assign(values, structuredClone(next)); },
        now: () => loaded.clock.now
      });
      loaded.api.runtime.state = structuredClone(initial);
      loaded.context.Tango.Store.executeBuy = async (order) => {
        loaded.calls.buy += 1;
        loaded.calls.buyOrders.push(order);
        const result = await coordinator.mutate(structuredClone({
          type: 'EXECUTE_BUY', order
        }));
        loaded.api.runtime.state = result.state;
        return result;
      };

      if (context === 'quick') {
        await loaded.api.handleQuickBuy({ token, quote: {}, amountNative: 1 });
      } else {
        await loaded.api.buy(1, { token, quote: {} });
      }

      assert.equal(loaded.calls.buy, 1, `${chain}:${context}`);
      const quote = loaded.calls.buyOrders[0].quote;
      assert.equal(quote.marketCapUsd, 3_200, `${chain}:${context}`);
      assert.equal(quote.totalSupply, 1_000_000_000, `${chain}:${context}`);
      assert.equal(quote.priceUsd, 3_200 / 1_000_000_000, `${chain}:${context}`);
      assert.equal(quote.nativePriceUsd, 1, `${chain}:${context}`);
      assert.equal(quote.syntheticTokenPrice, true, `${chain}:${context}`);
      assert.equal(quote.syntheticNativePrice, true, `${chain}:${context}`);
      assert.equal(quote.paperFallback, true, `${chain}:${context}`);
      assert.equal(loaded.api.runtime.toast?.type, 'success', `${chain}:${context}`);
      assert.equal(rejectedReasons.has(loaded.api.runtime.toast?.message), false, `${chain}:${context}`);
      assert.equal(loaded.api.runtime.modal, null, `${chain}:${context}`);
      const snapshot = (await coordinator.getAll()).state;
      const position = snapshot.positions[RealEngine.positionKey(chain, address)];
      const trade = snapshot.trades[0];
      assert.equal(snapshot.accounts[chain].cashBalanceNative, 9, `${chain}:${context}`);
      assert.equal(Object.keys(snapshot.positions).length, 1, `${chain}:${context}`);
      assert.ok(position, `${chain}:${context}`);
      assert.equal(snapshot.trades.length, 1, `${chain}:${context}`);
      assert.equal(trade.side, 'BUY', `${chain}:${context}`);
      assert.equal(position.lastMarketCapUsd, 3_200, `${chain}:${context}`);
      assert.equal(position.totalSupply, 1_000_000_000, `${chain}:${context}`);
      assert.equal(position.lastPriceUsd, 3_200 / 1_000_000_000, `${chain}:${context}`);
      assert.equal(position.lastNativePriceUsd, 1, `${chain}:${context}`);
      assert.equal(position.syntheticTokenPrice, true, `${chain}:${context}`);
      assert.equal(position.syntheticNativePrice, true, `${chain}:${context}`);
      assert.equal(position.paperFallback, true, `${chain}:${context}`);
      assert.equal(trade.syntheticTokenPrice, true, `${chain}:${context}`);
      assert.equal(trade.syntheticNativePrice, true, `${chain}:${context}`);
      assert.equal(trade.paperFallback, true, `${chain}:${context}`);
      assert.doesNotThrow(
        () => RealState.normalizeState(structuredClone(snapshot), settings, { strict: true }),
        `${chain}:${context}`
      );
    }
  }
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

test('content unknown fallback forms the internal market-cap supply contract used by Engine and State', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('eth', 2_000, loaded.clock.now);
  const token = { chain: 'eth', address: ADDRESS_A, symbol: 'FALLBACK' };
  const quote = loaded.api.resolvePaperTradeQuote(token, {});
  const initial = RealState.createInitialState({ now: 1, initialBalances: { eth: 10 } });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const bought = RealEngine.executeBuy(
    initial, { token, quote, amountNative: 1 }, settings, loaded.clock.now
  );

  assert.equal(quote.supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(quote.totalSupply, 1_000_000_000);
  assert.equal(quote.marketCapDivisor, 1_000_000_000);
  assert.equal(quote.provisionalSupply, 1_000_000_000);
  assert.equal(quote.syntheticTokenPrice, true);
  assert.equal(quote.provisional, true);
  assert.equal(quote.paperFallback, true);
  assert.equal(quote.valuationMode, 'MARKET_CAP');
  assert.equal(bought.position.supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(bought.position.valuationMode, 'MARKET_CAP');
  assert.doesNotThrow(() => RealState.normalizeState(bought.state, settings, { strict: true }));
});

test('factual price with a synthetic market cap cannot fabricate a GMGN ratio', async () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  const token = { chain: 'eth', address: ADDRESS_A, symbol: 'PRICE_ONLY' };
  const priceObservedAt = loaded.clock.now;
  const quote = loaded.api.resolvePaperTradeQuote(token, {
    chain: 'eth', address: ADDRESS_A,
    priceUsd: 0.01,
    nativePriceUsd: 1,
    observedAt: priceObservedAt,
    priceObservedAt,
    nativePriceObservedAt: priceObservedAt,
    source: 'GMGN_NETWORK',
    priceSource: 'GMGN_NETWORK',
    priceObservationId: 'price-only-observation',
    marketCapSource: 'GMGN_NETWORK',
    marketCapObservedAt: priceObservedAt,
    marketCapObservationId: 'price-only-observation'
  });
  const initial = RealState.createInitialState({ now: 1, initialBalances: { eth: 10 } });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(initial),
    [global.Tango.SETTINGS_KEY]: structuredClone(settings)
  };
  const coordinator = StateCoordinator.create({
    async readRaw(keys) {
      return Object.fromEntries(keys.filter((key) => key in values)
        .map((key) => [key, structuredClone(values[key])]));
    },
    async writeRaw(next) { Object.assign(values, structuredClone(next)); },
    now: () => loaded.clock.now
  });
  const result = await coordinator.mutate(structuredClone({
    type: 'EXECUTE_BUY',
    order: { token, quote, amountNative: 1 }
  }));

  assert.equal(quote.marketCapUsd, 3_200);
  assert.equal(quote.marketCapSource, 'TANGO_FALLBACK');
  assert.equal(quote.marketCapObservedAt, 0);
  assert.equal(quote.marketCapObservationId, '');
  assert.equal(quote.priceSource, 'GMGN_NETWORK');
  assert.equal(quote.priceObservedAt, priceObservedAt);
  assert.equal(quote.priceObservationId, 'price-only-observation');
  assert.equal(result.position.totalSupply, 1_000_000_000);
  assert.equal(result.position.supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(result.position.lastPriceUsd, 0.01);
  assert.equal(result.position.quantity, 100);
  assert.notEqual(result.position.totalSupply, 320_000);
  assert.doesNotThrow(() => RealState.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});

test('native-only fallback preserves a factual token price through resolver coordinator Engine and strict State', async () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  const token = { chain: 'eth', address: ADDRESS_A, symbol: 'PRICE_ONLY' };
  const priceObservedAt = loaded.clock.now;
  const quote = loaded.api.resolvePaperTradeQuote(token, {
    chain: 'eth', address: ADDRESS_A,
    priceUsd: 0.01,
    observedAt: priceObservedAt,
    priceObservedAt,
    source: 'GMGN_NETWORK',
    priceSource: 'GMGN_NETWORK',
    priceObservationId: 'native-missing-price-observation'
  });
  const initial = RealState.createInitialState({ now: 1, initialBalances: { eth: 10 } });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(initial),
    [global.Tango.SETTINGS_KEY]: structuredClone(settings)
  };
  const coordinator = StateCoordinator.create({
    async readRaw(keys) {
      return Object.fromEntries(keys.filter((key) => key in values)
        .map((key) => [key, structuredClone(values[key])]));
    },
    async writeRaw(next) { Object.assign(values, structuredClone(next)); },
    now: () => loaded.clock.now
  });

  assert.equal(quote.priceUsd, 0.01);
  assert.equal(quote.priceSource, 'GMGN_NETWORK');
  assert.equal(quote.priceObservedAt, priceObservedAt);
  assert.equal(quote.priceObservationId, 'native-missing-price-observation');
  assert.equal(quote.marketCapUsd, 3_200);
  assert.equal(quote.marketCapSource, 'TANGO_FALLBACK');
  assert.equal(quote.marketCapObservedAt, 0);
  assert.equal(quote.marketCapObservationId, '');
  assert.equal(quote.totalSupply, 1_000_000_000);
  assert.equal(quote.supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(quote.nativePriceUsd, 1);
  assert.equal(quote.syntheticTokenPrice, false);
  assert.equal(quote.syntheticNativePrice, true);
  assert.equal(quote.provisional, true);

  const result = await coordinator.mutate(structuredClone({
    type: 'EXECUTE_BUY',
    order: { token, quote, amountNative: 1 }
  }));
  const key = RealEngine.positionKey('eth', ADDRESS_A);

  assert.equal(result.state.accounts.eth.cashBalanceNative, 9);
  assert.equal(result.state.positions[key].quantity, 100);
  assert.equal(result.state.positions[key].lastPriceUsd, 0.01);
  assert.equal(result.state.positions[key].lastMarketCapUsd, 3_200);
  assert.equal(result.state.positions[key].lastNativePriceUsd, 1);
  assert.equal(result.state.positions[key].syntheticTokenPrice, false);
  assert.equal(result.state.positions[key].syntheticNativePrice, true);
  assert.equal(result.state.trades.length, 1);
  assert.equal(result.trade.observedPriceUsd, 0.01);
  assert.equal(result.trade.quoteSource, 'GMGN_NETWORK');
  assert.equal(result.trade.quoteObservedAtOriginal, priceObservedAt);
  assert.equal(result.trade.syntheticTokenPrice, false);
  assert.equal(result.trade.syntheticNativePrice, true);
  assert.doesNotThrow(() => RealState.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
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

test('page-message cache cannot launder an explicit zero price timestamp through a fresh envelope', async () => {
  let loaded;
  loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    sendMessage: (message) => message.type === 'TANGO_GET_TOKEN_QUOTE'
      ? Promise.resolve({
        quote: {
          chain: 'base', address: ADDRESS_A, priceUsd: 3,
          observedAt: loaded.clock.now, source: 'DEXSCREENER', priceProvenance: 'OBSERVED_PRICE'
        }
      })
      : Promise.resolve({ ok: true })
  });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'ZERO_TIME' }, quote: {}
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'base', address: ADDRESS_A, priceUsd: 9,
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK',
      priceObservedAt: 0, priceSource: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
    }]
  });

  assert.equal(loaded.api.runtime.gmgnQuotes.size, 0);
  const fallback = loaded.api.resolvePaperTradeQuote(
    loaded.api.runtime.current.token, loaded.api.runtime.current.quote
  );
  assert.equal(fallback.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(fallback.source, 'TANGO_FALLBACK');

  loaded.api.ensureTokenQuote(loaded.api.runtime.current);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loaded.messages.filter((message) => message.type === 'TANGO_GET_TOKEN_QUOTE').length, 1);
  assert.equal(loaded.api.runtime.current.quote.priceUsd, 3);
  assert.equal(loaded.api.runtime.current.quote.priceObservedAt, loaded.clock.now);
  assert.equal(loaded.api.runtime.current.quote.priceSource, 'DEXSCREENER');

  await loaded.api.buy(1, loaded.api.runtime.current);
  assert.equal(loaded.calls.buy, 1);
  assert.notEqual(loaded.api.runtime.toast?.message, 'staleQuote');
});

test('page-message cache cannot launder an explicit empty price source through a fresh envelope', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'EMPTY_SOURCE' }, quote: {}
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'base', address: ADDRESS_A, priceUsd: 9,
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK',
      priceObservedAt: loaded.clock.now, priceSource: '', priceProvenance: 'OBSERVED_PRICE'
    }]
  });

  assert.equal(loaded.api.runtime.gmgnQuotes.size, 0);
  const fallback = loaded.api.resolvePaperTradeQuote(
    loaded.api.runtime.current.token, loaded.api.runtime.current.quote
  );
  assert.equal(fallback.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(fallback.source, 'TANGO_FALLBACK');
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

test('cached exact supply wins without making a cross-observation card price factual', () => {
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
  assert.equal(quote.syntheticTokenPrice, true);
  assert.equal(quote.provisionalSupply, 0);
  assert.equal(quote.provisional, true);
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

test('a fresh Bankr supply-only observation cannot combine with historical 3200 USD into a factual price', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/robinhood/token/${ADDRESS_A}` });
  const token = {
    chain: 'robinhood', address: ADDRESS_A, symbol: 'BANKR', launchpad: 'Bankr.bot',
    metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  };
  loaded.api.rememberNativePrice('robinhood', 2_000, loaded.clock.now);
  const entryQuote = loaded.api.resolvePaperTradeQuote(token, {});
  const initial = RealState.createInitialState({
    now: 1, initialBalances: { robinhood: 10 }
  });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { robinhood: { networkFeeNative: 0 } }
  });
  const bought = RealEngine.executeBuy(
    initial, { token, quote: entryQuote, amountNative: 6 }, settings, loaded.clock.now
  );
  loaded.api.runtime.state = bought.state;

  const [supplyOnly] = GMGNQuotes.extract({
    address: ADDRESS_A, total_supply: '100B'
  }, 'robinhood', loaded.clock.now);
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [supplyOnly]
  });
  const quote = loaded.api.resolvePaperTradeQuote(token, supplyOnly, { position: bought.position });

  assert.equal(bought.position.quantity, 375_000_000_000);
  assert.equal(quote.totalSupply, 100_000_000_000);
  assert.equal(quote.priceUsd, 3_200 / 100_000_000_000);
  assert.equal(quote.syntheticTokenPrice, true);
  assert.equal(quote.provisionalSupply, 0);
});

test('a fresh market-cap-only observation cannot borrow position-only GMGN exact supply provenance', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/robinhood/token/${ADDRESS_A}` });
  const token = {
    chain: 'robinhood', address: ADDRESS_A, symbol: 'BANKR', launchpad: 'Bankr.bot',
    metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  };
  loaded.api.rememberNativePrice('robinhood', 2_000, loaded.clock.now);
  const entryQuote = loaded.api.resolvePaperTradeQuote(token, {});
  const initial = RealState.createInitialState({
    now: 1, initialBalances: { robinhood: 10 }
  });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { robinhood: { networkFeeNative: 0 } }
  });
  const bought = RealEngine.executeBuy(
    initial, { token, quote: entryQuote, amountNative: 6 }, settings, loaded.clock.now
  );
  const position = bought.position;
  position.supplySource = 'GMGN_EXACT';
  delete position.totalSupplyObservationSource;
  delete position.totalSupplyObservationId;
  delete position.totalSupplyObservedAt;
  loaded.api.runtime.state = bought.state;
  loaded.clock.now += 1_000;

  const [marketCapOnly] = GMGNQuotes.extract({
    address: ADDRESS_A, market_cap: '6400'
  }, 'robinhood', loaded.clock.now);
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [marketCapOnly]
  });
  const quote = loaded.api.resolvePaperTradeQuote(token, marketCapOnly, { position });

  assert.equal(position.quantity, 375_000_000_000);
  assert.equal(quote.totalSupply, 100_000_000_000);
  assert.equal(quote.supplySource, 'GMGN_EXACT');
  assert.equal(quote.marketCapUsd, 3_200);
  assert.equal(quote.priceUsd, 3_200 / 100_000_000_000);
  assert.equal(quote.syntheticTokenPrice, true);
  assert.equal(quote.provisional, true);
  assert.equal(quote.valuationMode, 'PRICE');
  assert.equal(quote.valuationSource, 'POSITION_HISTORY');
  assert.notEqual(quote.priceProvenance, 'MARKET_CAP_DERIVED');
});

test('polluted Bankr payload still buys and sells six ETH at the unchanged 3200 USD market cap', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/robinhood/token/${ADDRESS_A}` });
  const token = {
    chain: 'robinhood', address: ADDRESS_A, symbol: 'BANKR', launchpad: 'Bankr.bot',
    metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  };
  loaded.api.rememberNativePrice('robinhood', 2_000, loaded.clock.now);
  const settings = RealState.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { robinhood: { networkFeeNative: 0 } }
  });
  const initial = RealState.createInitialState({
    now: 1, initialBalances: { robinhood: 10 }
  });
  initial.initialized = true;
  const entryQuote = loaded.api.resolvePaperTradeQuote(token, {});
  const bought = RealEngine.executeBuy(
    initial, { token, quote: entryQuote, amountNative: 6 }, settings, loaded.clock.now
  );

  const [polluted] = GMGNQuotes.extract({
    address: ADDRESS_A,
    total_supply: '100B',
    nested: { address: ADDRESS_A, supply: '1B' }
  }, 'robinhood', loaded.clock.now);
  loaded.api.runtime.state = bought.state;
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [polluted]
  });
  const exitQuote = loaded.api.resolvePaperTradeQuote(token, polluted, { position: bought.position });
  const sold = RealEngine.executeSell(
    bought.state, { token, quote: exitQuote, percent: 100 }, settings, loaded.clock.now
  );

  assert.equal(entryQuote.totalSupply, 100_000_000_000);
  assert.equal(bought.position.quantity, 375_000_000_000);
  assert.equal(polluted.totalSupply, 100_000_000_000);
  assert.equal(exitQuote.totalSupply, 100_000_000_000);
  assert.equal(exitQuote.priceUsd, 3_200 / 100_000_000_000);
  assert.equal(exitQuote.syntheticTokenPrice, true);
  assert.equal(sold.trade.amountNative, 6);
  assert.equal(sold.trade.realizedPnlNative, 0);
  assert.equal(sold.state.accounts.robinhood.cashBalanceNative, 10);
  assert.equal(Object.keys(sold.state.positions).length, 0);
});

test('sanitized no-chart market-cap candidates preserve Bankr 100B and unknown 1B zero-fee round trips', () => {
  const cases = [
    { launchpad: 'Bankr.bot', expectedSupply: 100_000_000_000, expectedQuantity: 375_000_000_000 },
    { launchpad: '', expectedSupply: 1_000_000_000, expectedQuantity: 3_750_000_000 }
  ];
  for (const item of cases) {
    const loaded = loadContent({ href: `https://gmgn.ai/robinhood/token/${ADDRESS_A}` });
    const token = {
      chain: 'robinhood', address: ADDRESS_A, symbol: 'DIMENSION', launchpad: item.launchpad,
      metadataVerified: true, metadataSource: 'GMGN_NETWORK'
    };
    loaded.api.rememberNativePrice('robinhood', 2_000, loaded.clock.now);
    const settings = RealState.normalizeSettings({
      slippageBps: 0, platformFeeBps: 0,
      chains: { robinhood: { networkFeeNative: 0 } }
    });
    const initial = RealState.createInitialState({
      now: 1, initialBalances: { robinhood: 10 }
    });
    initial.initialized = true;
    const noChartCandidate = {
      chain: 'robinhood', address: ADDRESS_A, priceUsd: 0, marketCapUsd: 3_200,
      observedAt: loaded.clock.now, source: 'GMGN', valuationMode: 'MARKET_CAP',
      priceProvenance: 'MARKET_CAP_DERIVED'
    };
    const entryQuote = loaded.api.resolvePaperTradeQuote(token, noChartCandidate);
    const bought = RealEngine.executeBuy(
      initial, { token, quote: entryQuote, amountNative: 6 }, settings, loaded.clock.now
    );
    const exitQuote = loaded.api.resolvePaperTradeQuote(token, noChartCandidate, {
      position: bought.position
    });
    const sold = RealEngine.executeSell(
      bought.state, { token, quote: exitQuote, percent: 100 }, settings, loaded.clock.now
    );

    assert.equal(entryQuote.totalSupply, item.expectedSupply, item.launchpad || 'unknown');
    assert.equal(entryQuote.priceUsd, 3_200 / item.expectedSupply, item.launchpad || 'unknown');
    assert.equal(bought.position.quantity, item.expectedQuantity, item.launchpad || 'unknown');
    assert.equal(sold.trade.amountNative, 6, item.launchpad || 'unknown');
    assert.equal(sold.state.accounts.robinhood.cashBalanceNative, 10, item.launchpad || 'unknown');
  }
});

test('zero-fee 3200 USD launchpad entries preserve deterministic 1B 2B and 100B quantities', () => {
  const cases = [
    {
      chain: 'sol', address: SOL_ADDRESS, launchpad: 'Pump.fun', launchMode: '',
      expectedQuantity: 3_750_000_000
    },
    {
      chain: 'sol', address: SOL_ADDRESS, launchpad: 'Pump.fun', launchMode: 'Mayhem',
      expectedQuantity: 7_500_000_000
    },
    {
      chain: 'robinhood', address: ADDRESS_A, launchpad: 'Banker', launchMode: '',
      expectedQuantity: 375_000_000_000
    }
  ];

  for (const item of cases) {
    const loaded = loadContent({
      href: `https://gmgn.ai/${item.chain}/token/${item.address}`
    });
    const token = {
      ...item,
      symbol: 'DIMENSION',
      metadataVerified: true,
      metadataSource: 'GMGN_NETWORK'
    };
    loaded.api.rememberNativePrice(item.chain, 2_000, loaded.clock.now);
    const quote = loaded.api.resolvePaperTradeQuote(token, {});
    const initial = RealState.createInitialState({
      now: 1, initialBalances: { [item.chain]: 10 }
    });
    initial.initialized = true;
    const settings = RealState.normalizeSettings({
      slippageBps: 0,
      platformFeeBps: 0,
      chains: { [item.chain]: { networkFeeNative: 0 } }
    });
    const bought = RealEngine.executeBuy(
      initial, { token, quote, amountNative: 6 }, settings, loaded.clock.now
    );
    assert.equal(bought.position.quantity, item.expectedQuantity, `${item.chain}:${item.launchMode}`);
  }
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

test('first detail sell closes an unknown fallback after metadata-only launchpad upgrade', async () => {
  const scenarios = [
    {
      name: 'Bankr', chain: 'robinhood', address: ADDRESS_A,
      launchpad: 'Bankr.bot', launchMode: '', expectedSupply: 100_000_000_000
    },
    {
      name: 'Clanker', chain: 'base', address: ADDRESS_A,
      launchpad: 'Clanker', launchMode: '', expectedSupply: 100_000_000_000
    },
    {
      name: 'Mayhem', chain: 'sol', address: SOL_ADDRESS,
      launchpad: 'Pump.fun', launchMode: 'Mayhem', expectedSupply: 2_000_000_000
    }
  ];

  for (const scenario of scenarios) {
    const never = deferred();
    const loaded = loadContent({
      href: `https://gmgn.ai/?chain=${scenario.chain}`,
      readCurrentToken: () => never.promise,
      sendMessage: (message) => /TANGO_GET_(TOKEN_QUOTE|NATIVE_PRICE)/.test(message.type)
        ? never.promise
        : Promise.resolve({ ok: true })
    });
    const initial = RealState.createInitialState({
      now: 1,
      initialBalances: { [scenario.chain]: 10 }
    });
    initial.initialized = true;
    const settings = RealState.normalizeSettings({
      ...defaultSettings(),
      fastMode: true,
      confirmationEnabled: false,
      slippageBps: 0,
      platformFeeBps: 0,
      chains: Object.fromEntries(Chains.all().map(({ id }) => [id, {
        buyPresets: [1], networkFeeNative: 0
      }]))
    });
    const values = {
      [global.Tango.STORAGE_KEY]: structuredClone(initial),
      [global.Tango.SETTINGS_KEY]: structuredClone(settings)
    };
    let sellMutations = 0;
    const coordinator = StateCoordinator.create({
      async readRaw(keys) {
        return Object.fromEntries(keys.filter((key) => key in values)
          .map((key) => [key, structuredClone(values[key])]));
      },
      async writeRaw(next) { Object.assign(values, structuredClone(next)); },
      now: () => loaded.clock.now
    });
    loaded.context.Tango.Engine = RealEngine;
    loaded.context.Tango.Store.executeBuy = (order) => coordinator.mutate(structuredClone({
      type: 'EXECUTE_BUY', order
    }));
    loaded.context.Tango.Store.executeSell = (order) => {
      sellMutations += 1;
      return coordinator.mutate(structuredClone({ type: 'EXECUTE_SELL', order }));
    };
    loaded.api.runtime.state = structuredClone(initial);
    loaded.api.runtime.settings = settings;

    await loaded.api.handleQuickBuy({
      token: { chain: scenario.chain, address: scenario.address, symbol: 'NEW' },
      quote: {},
      amountNative: 1,
      sourceUrl: `https://gmgn.ai/?chain=${scenario.chain}`
    });

    const key = RealEngine.positionKey(scenario.chain, scenario.address);
    const bought = (await coordinator.getAll()).state;
    assert.equal(bought.accounts[scenario.chain].cashBalanceNative, 9, scenario.name);
    assert.equal(bought.positions[key].totalSupply, 1_000_000_000, scenario.name);
    assert.equal(bought.positions[key].supplySource, 'UNKNOWN_FALLBACK', scenario.name);
    assert.equal(bought.positions[key].provisionalSupply, 1_000_000_000, scenario.name);
    assert.equal(bought.positions[key].syntheticTokenPrice, true, scenario.name);
    assert.equal(bought.positions[key].lastMarketCapUsd, 3_200, scenario.name);
    assert.equal(bought.trades.length, 1, scenario.name);
    assert.equal(bought.trades[0].side, 'BUY', scenario.name);

    loaded.context.location.href = `https://gmgn.ai/${scenario.chain}/token/${scenario.address}`;
    loaded.api.handleRouteChange();
    loaded.api.runtime.current = {
      token: {
        chain: scenario.chain,
        address: scenario.address,
        symbol: scenario.name,
        name: scenario.name,
        logoUrl: '',
        launchpad: scenario.launchpad,
        launchMode: scenario.launchMode,
        metadataVerified: true,
        metadataSource: 'GMGN_DETAIL'
      },
      quote: {}
    };

    assert.equal(loaded.calls.updatePositionQuotes.length, 0, scenario.name);
    assert.equal(loaded.api.runtime.state.positions[key].supplySource, 'UNKNOWN_FALLBACK', scenario.name);

    await loaded.api.sell(100);

    const closed = (await coordinator.getAll()).state;
    assert.equal(sellMutations, 1, scenario.name);
    assert.equal(loaded.api.runtime.toast?.type, 'success', scenario.name);
    assert.equal(closed.positions[key], undefined, scenario.name);
    assert.ok(Math.abs(closed.accounts[scenario.chain].cashBalanceNative - 10) <= 1e-12,
      scenario.name);
    assert.ok(Number.isFinite(closed.accounts[scenario.chain].cashBalanceNative), scenario.name);
    assert.ok(closed.accounts[scenario.chain].cashBalanceNative >= 0, scenario.name);
    assert.equal(closed.trades.length, 2, scenario.name);
    assert.equal(closed.trades[0].side, 'SELL', scenario.name);
    assert.equal(closed.trades[1].side, 'BUY', scenario.name);
    assert.equal(closed.trades[0].totalSupply, scenario.expectedSupply, scenario.name);
    assert.equal(closed.trades[0].supplySource, 'LAUNCHPAD_RULE', scenario.name);
    assert.equal(closed.trades[0].marketCapUsd, 3_200, scenario.name);
    assert.ok(Number.isFinite(closed.trades[0].quantity) && closed.trades[0].quantity > 0,
      scenario.name);
    assert.equal(closed.calibrations[0].fromSupply, 1_000_000_000, scenario.name);
    assert.equal(closed.calibrations[0].toSupply, scenario.expectedSupply, scenario.name);
    assert.equal(closed.stateRevision, 2, scenario.name);
    assert.doesNotThrow(() => RealState.normalizeState(
      structuredClone(closed), settings, { strict: true }
    ), scenario.name);
  }
});

test('metadata-only launchpad upgrade reaches repeat buy through the real coordinator once', async () => {
  const never = deferred();
  const loaded = loadContent({
    href: 'https://gmgn.ai/?chain=robinhood',
    readCurrentToken: () => never.promise,
    sendMessage: (message) => /TANGO_GET_(TOKEN_QUOTE|NATIVE_PRICE)/.test(message.type)
      ? never.promise
      : Promise.resolve({ ok: true })
  });
  const initial = RealState.createInitialState({ now: 1, initialBalances: { robinhood: 10 } });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    ...defaultSettings(), fastMode: true, confirmationEnabled: false,
    slippageBps: 0, platformFeeBps: 0,
    chains: Object.fromEntries(Chains.all().map(({ id }) => [id, {
      buyPresets: [1], networkFeeNative: 0
    }]))
  });
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(initial),
    [global.Tango.SETTINGS_KEY]: structuredClone(settings)
  };
  let buyMutations = 0;
  const coordinator = StateCoordinator.create({
    async readRaw(keys) {
      return Object.fromEntries(keys.filter((key) => key in values)
        .map((key) => [key, structuredClone(values[key])]));
    },
    async writeRaw(next) { Object.assign(values, structuredClone(next)); },
    now: () => loaded.clock.now
  });
  loaded.context.Tango.Engine = RealEngine;
  loaded.context.Tango.Store.executeBuy = (order) => {
    buyMutations += 1;
    return coordinator.mutate(structuredClone({ type: 'EXECUTE_BUY', order }));
  };
  loaded.api.runtime.state = structuredClone(initial);
  loaded.api.runtime.settings = settings;

  await loaded.api.handleQuickBuy({
    token: { chain: 'robinhood', address: ADDRESS_A, symbol: 'NEW' }, quote: {}, amountNative: 1,
    sourceUrl: 'https://gmgn.ai/?chain=robinhood'
  });
  const key = RealEngine.positionKey('robinhood', ADDRESS_A);
  assert.equal((await coordinator.getAll()).state.positions[key].supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(buyMutations, 1);

  loaded.context.location.href = `https://gmgn.ai/robinhood/token/${ADDRESS_A}`;
  loaded.api.handleRouteChange();
  loaded.api.runtime.current = {
    token: {
      chain: 'robinhood', address: ADDRESS_A, symbol: 'Bankr', name: 'Bankr', logoUrl: '',
      launchpad: 'Bankr.bot', launchMode: '', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
    },
    quote: {}
  };
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);

  await loaded.api.buy(1);

  const repeated = (await coordinator.getAll()).state;
  assert.equal(buyMutations, 2);
  assert.equal(loaded.api.runtime.toast?.type, 'success');
  assert.equal(repeated.trades.length, 2);
  assert.equal(repeated.positions[key].totalSupply, 100_000_000_000);
  assert.equal(repeated.positions[key].supplySource, 'LAUNCHPAD_RULE');
  assert.equal(repeated.calibrations[0].fromSupply, 1_000_000_000);
  assert.equal(repeated.calibrations[0].toSupply, 100_000_000_000);
});

test('content execution pre-validation trusts only verified same-token GMGN metadata', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  const initial = RealState.createInitialState({ now: 1, initialBalances: { base: 10 } });
  initial.initialized = true;
  const settings = RealState.normalizeSettings({
    ...defaultSettings(), slippageBps: 0, platformFeeBps: 0,
    chains: Object.fromEntries(Chains.all().map(({ id }) => [id, {
      buyPresets: [1], networkFeeNative: 0
    }]))
  });
  const unknownToken = { chain: 'base', address: ADDRESS_A, symbol: 'NEW' };
  const unknownQuote = loaded.api.resolvePaperTradeQuote(unknownToken, {});
  const bought = RealEngine.executeBuy(initial, {
    token: unknownToken, quote: unknownQuote, amountNative: 1
  }, settings, loaded.clock.now);
  const position = bought.state.positions[RealEngine.positionKey('base', ADDRESS_A)];
  loaded.api.runtime.state = bought.state;
  loaded.api.runtime.settings = settings;
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  const verified = {
    chain: 'base', address: ADDRESS_A, symbol: 'Clanker', launchpad: 'Clanker', launchMode: '',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL',
    priceUsd: 999, marketCapUsd: 999, totalSupply: 999, supplySource: 'GMGN_EXACT', observedAt: 999
  };
  const quote = loaded.api.resolvePaperTradeQuote(verified, {}, { position });
  assert.equal(quote.supplySource, 'LAUNCHPAD_RULE');
  assert.equal(quote.totalSupply, 100_000_000_000);

  assert.equal(typeof loaded.api.executionValidationTrustContext, 'function');
  const trusted = loaded.api.executionValidationTrustContext(position, verified);
  assert.equal(trusted.launchpad, 'Clanker');
  assert.equal(trusted.launchMode, '');
  assert.equal(trusted.totalSupply, position.totalSupply);
  assert.equal(trusted.supplySource, position.supplySource);
  assert.equal(trusted.lastMarketCapUsd, position.lastMarketCapUsd);
  assert.equal(RealEngine.validateQuote(quote, loaded.clock.now, undefined, position, trusted).ok, true);

  const rejected = [
    { name: 'unverified', token: { ...verified, metadataVerified: false } },
    { name: 'untrusted source', token: { ...verified, metadataSource: 'UNTRUSTED' } },
    { name: 'cross chain', token: { ...verified, chain: 'eth' } },
    { name: 'wrong address', token: { ...verified, address: ADDRESS_B } }
  ];
  for (const item of rejected) {
    const trust = loaded.api.executionValidationTrustContext(position, item.token);
    const validation = RealEngine.validateQuote(quote, loaded.clock.now, undefined, position, trust);
    assert.equal(validation.ok, false, item.name);
    assert.equal(validation.reason, 'invalidQuote', item.name);
  }
});

test('content execution pre-validation strips untrusted no-position caller trust', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/base/token/${ADDRESS_A}` });
  loaded.api.rememberNativePrice('base', 2_000, loaded.clock.now);
  const quote = {
    chain: 'base', address: ADDRESS_A,
    priceUsd: 3_200 / 100_000_000_000,
    marketCapUsd: 3_200,
    totalSupply: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE',
    valuationMode: 'MARKET_CAP',
    source: 'GMGN_NETWORK',
    priceSource: 'GMGN_NETWORK',
    marketCapSource: 'GMGN_NETWORK',
    priceObservedAt: loaded.clock.now,
    marketCapObservedAt: loaded.clock.now,
    observedAt: loaded.clock.now
  };
  const baseToken = {
    chain: 'base', address: ADDRESS_A, symbol: 'CLANK', launchpad: 'Clanker', launchMode: ''
  };

  for (const token of [
    { ...baseToken, metadataVerified: false, metadataSource: 'GMGN_DETAIL' },
    { ...baseToken, metadataVerified: true, metadataSource: 'UNTRUSTED' }
  ]) {
    assert.throws(() => loaded.api.requireExecutableQuote(token, quote), /invalidQuote/);
  }

  const verified = {
    ...baseToken, metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  assert.ok(loaded.api.requireExecutableQuote(verified, quote));
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
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.priceUsd, 0.000002);
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

test('detail sell commits the verified synchronous DOM quote instead of the cached quote', async () => {
  let loaded;
  loaded = loadContent({
    readVerifiedCurrentTokenSnapshot: () => ({
      token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
      quote: detailQuote(4_300, loaded.clock.now)
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

test('detail buy commits the verified synchronous DOM quote', async () => {
  let loaded;
  loaded = loadContent({
    readVerifiedCurrentTokenSnapshot: () => ({
      token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
      quote: detailQuote(4_300, loaded.clock.now)
    })
  });
  const context = seedHeldDetailPosition(loaded, 3_750);

  await loaded.api.buy(1, context);

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 1);
  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 4_300);
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 4_300 / 1_000_000_000);
});

test('detail confirmation keeps the cached preview but commits the final DOM snapshot', async () => {
  let loaded;
  loaded = loadContent({
    readVerifiedCurrentTokenSnapshot: () => ({
      token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
      quote: detailQuote(4_300, loaded.clock.now)
    })
  });
  const context = seedHeldDetailPosition(loaded, 3_750);
  loaded.api.runtime.settings.confirmationEnabled = true;

  await loaded.api.buy(1, context);

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 0);
  assert.deepEqual(Array.from(loaded.api.runtime.modal.rows, (row) => Array.from(row))
    .filter(([key]) => key === 'observedPrice'), [['observedPrice', '$0.00000375']]);
  const confirm = loaded.api.runtime.modal.action;
  await confirm();
  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 4_300);
});

test('order-local DOM dimensions beat a cache field timestamp one millisecond newer', async () => {
  let loaded;
  loaded = loadContent({
    readVerifiedCurrentTokenSnapshot: () => ({
      token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
      quote: detailQuote(4_300, loaded.clock.now)
    })
  });
  seedHeldDetailPosition(loaded, 3_750);
  loaded.api.runtime.gmgnQuotes.set(`eth:${ADDRESS_A}`, detailQuote(3_750, loaded.clock.now + 1));

  await loaded.api.sell(100);

  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 4_300);
  assert.equal(loaded.calls.sellOrders[0].quote.priceObservedAt, loaded.clock.now);
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapObservedAt, loaded.clock.now);
});

test('detail commit ignores a verified DOM snapshot returned for another token', async () => {
  let loaded;
  loaded = loadContent({
    readVerifiedCurrentTokenSnapshot: () => ({
      token: { chain: 'eth', address: ADDRESS_B, symbol: 'OTHER' },
      quote: detailQuote(4_300, loaded.clock.now, ADDRESS_B)
    })
  });
  seedHeldDetailPosition(loaded, 3_750);

  await loaded.api.sell(100);

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 3_750);
});

test('matching detail token rejects unusable snapshot quotes without replacing the frozen order quote', async (t) => {
  const cases = [
    ['missing quote', () => null],
    ['untrusted quote', (loaded) => ({
      ...detailQuote(4_300, loaded.clock.now),
      source: 'PAGE_TEXT', priceSource: 'PAGE_TEXT', marketCapSource: 'PAGE_TEXT'
    })],
    ['identity-mismatched quote', (loaded) => detailQuote(4_300, loaded.clock.now, ADDRESS_B)]
  ];

  for (const [name, snapshotQuote] of cases) {
    await t.test(name, async () => {
      let loaded;
      loaded = loadContent({
        readVerifiedCurrentTokenSnapshot: () => {
          loaded.api.runtime.gmgnQuotes.set(
            `eth:${ADDRESS_A}`, detailQuote(3_900, loaded.clock.now + 1)
          );
          return {
            token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
            quote: snapshotQuote(loaded)
          };
        }
      });
      seedHeldDetailPosition(loaded, 3_750);

      await loaded.api.sell(100);

      assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 1);
      assert.equal(loaded.calls.sell, 1);
      assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 3_750);
      assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, 3_750 / 1_000_000_000);
    });
  }
});

test('trench quick buy preserves the card quote without reading the detail DOM snapshot', async () => {
  let loaded;
  loaded = loadContent({
    href: 'https://gmgn.ai/eth/trenches',
    readVerifiedCurrentTokenSnapshot: () => ({
      token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
      quote: detailQuote(4_300, loaded.clock.now)
    })
  });
  loaded.api.runtime.settings.confirmationEnabled = false;
  const context = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
    quote: detailQuote(3_750, loaded.clock.now),
    amountNative: 1
  };

  await loaded.api.handleQuickBuy(context);

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 0);
  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 3_750);
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

test('delayed confirmation preserves factual observation times and the real engine rejects the stale order', async () => {
  const loaded = loadContent();
  const observedAt = loaded.clock.now;
  const context = quoteContext();
  context.quote = {
    ...context.quote,
    priceObservedAt: observedAt,
    marketCapObservedAt: observedAt,
    nativePriceObservedAt: observedAt,
    priceProvenance: 'OBSERVED_PRICE'
  };
  loaded.api.rememberNativePrice('eth', 3_000, observedAt);
  const executionSettings = RealState.normalizeSettings(defaultSettings());
  let attemptedOrder = null;
  let commits = 0;
  loaded.context.Tango.Store.executeBuy = async (order) => {
    attemptedOrder = order;
    const result = RealEngine.executeBuy(loaded.api.runtime.state, order, executionSettings, loaded.clock.now);
    commits += 1;
    return result;
  };

  await loaded.api.buy(1, context);
  const confirm = loaded.api.runtime.modal.action;
  loaded.clock.now += loaded.context.Tango.QUOTE_STALE_MS + 1;
  await confirm();

  assert.equal(attemptedOrder.quote.observedAt, observedAt);
  assert.equal(attemptedOrder.quote.priceObservedAt, observedAt);
  assert.equal(attemptedOrder.quote.marketCapObservedAt, observedAt);
  assert.equal(attemptedOrder.quote.nativePriceObservedAt, observedAt);
  assert.equal(commits, 0);
  assert.equal(loaded.api.runtime.state.trades.length, 0);
  assert.equal(loaded.api.runtime.toast.type, 'error');
  assert.equal(loaded.api.runtime.toast.message, 'staleQuote');
});

test('a fresh background DEX quote replaces stale field freshness and commits the local paper buy', async () => {
  let loaded;
  loaded = loadContent({
    sendMessage: (message) => message.type === 'TANGO_GET_TOKEN_QUOTE'
      ? Promise.resolve({
        quote: {
          chain: 'eth', address: ADDRESS_A,
          priceUsd: 2, marketCapUsd: 200, liquidityUsd: 50,
          observedAt: loaded.clock.now, source: 'DEXSCREENER', priceProvenance: 'OBSERVED_PRICE'
        }
      })
      : Promise.resolve({ ok: true })
  });
  const staleObservedAt = loaded.clock.now - loaded.context.Tango.QUOTE_STALE_MS - 1;
  loaded.api.runtime.current = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'DEX' },
    quote: {
      chain: 'eth', address: ADDRESS_A,
      priceUsd: 1, marketCapUsd: 100, liquidityUsd: 25,
      observedAt: staleObservedAt, source: 'GMGN',
      priceObservedAt: staleObservedAt, priceSource: 'GMGN',
      marketCapObservedAt: staleObservedAt, marketCapSource: 'GMGN',
      liquidityObservedAt: staleObservedAt, liquiditySource: 'GMGN'
    }
  };
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  loaded.api.runtime.settings.confirmationEnabled = false;

  loaded.api.ensureTokenQuote(loaded.api.runtime.current);
  await new Promise((resolve) => setImmediate(resolve));

  const merged = loaded.api.runtime.current.quote;
  assert.deepEqual({
    price: [merged.priceObservedAt, merged.priceSource],
    marketCap: [merged.marketCapObservedAt, merged.marketCapSource],
    liquidity: [merged.liquidityObservedAt, merged.liquiditySource]
  }, {
    price: [loaded.clock.now, 'DEXSCREENER'],
    marketCap: [loaded.clock.now, 'DEXSCREENER'],
    liquidity: [loaded.clock.now, 'DEXSCREENER']
  });

  await loaded.api.buy(1, loaded.api.runtime.current);

  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.api.runtime.toast?.type, 'success');
  assert.match(loaded.api.runtime.toast?.message || '', /^buySuccess/);
});

test('a fresh envelope with an explicitly stale price dimension buys through deterministic fallback', async () => {
  const loaded = loadContent();
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  loaded.api.runtime.settings.confirmationEnabled = false;
  const context = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'STALE_FIELD' },
    quote: {
      chain: 'eth', address: ADDRESS_A, priceUsd: 2,
      observedAt: loaded.clock.now, source: 'GMGN',
      priceObservedAt: loaded.clock.now - loaded.context.Tango.QUOTE_STALE_MS - 1,
      priceSource: 'GMGN', priceProvenance: 'OBSERVED_PRICE'
    }
  };

  await loaded.api.buy(1, context);

  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 3_200);
  assert.equal(loaded.calls.buyOrders[0].quote.source, 'TANGO_FALLBACK');
  assert.equal(loaded.calls.buyOrders[0].quote.syntheticTokenPrice, true);
  assert.notEqual(loaded.api.runtime.toast?.message, 'staleQuote');
});

test('a fresh envelope with a wrong price source buys through deterministic fallback', async () => {
  const loaded = loadContent();
  loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
  loaded.api.runtime.settings.confirmationEnabled = false;
  const context = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'WRONG_SOURCE' },
    quote: {
      chain: 'eth', address: ADDRESS_A, priceUsd: 2,
      observedAt: loaded.clock.now, source: 'GMGN',
      priceObservedAt: loaded.clock.now, priceSource: 'PAGE_TEXT',
      priceProvenance: 'OBSERVED_PRICE'
    }
  };

  await loaded.api.buy(1, context);

  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 3_200 / 1_000_000_000);
  assert.equal(loaded.calls.buyOrders[0].quote.marketCapUsd, 3_200);
  assert.equal(loaded.calls.buyOrders[0].quote.source, 'TANGO_FALLBACK');
  assert.equal(loaded.calls.buyOrders[0].quote.syntheticTokenPrice, true);
});

test('stale or wrong-source market-cap dimensions cannot change deterministic fallback valuation', () => {
  for (const invalidField of [
    {
      marketCapObservedAt: 1_000_000 - 15_001,
      marketCapSource: 'GMGN'
    },
    {
      marketCapObservedAt: 1_000_000,
      marketCapSource: 'PAGE_TEXT'
    }
  ]) {
    const loaded = loadContent();
    loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
    const quote = loaded.api.resolvePaperTradeQuote(
      { chain: 'eth', address: ADDRESS_A, symbol: 'BAD_MC' },
      {
        chain: 'eth', address: ADDRESS_A, priceUsd: 0, marketCapUsd: 999_999,
        observedAt: loaded.clock.now, source: 'GMGN', ...invalidField
      }
    );

    assert.equal(quote.priceUsd, 3_200 / 1_000_000_000);
    assert.equal(quote.marketCapUsd, 3_200);
    assert.equal(quote.marketCapSource, 'TANGO_FALLBACK');
    assert.equal(quote.marketCapObservedAt, 0);
  }
});

test('an explicitly stale price dimension cannot suppress a verified background refresh', async () => {
  let loaded;
  loaded = loadContent({
    sendMessage: (message) => message.type === 'TANGO_GET_TOKEN_QUOTE'
      ? Promise.resolve({
        quote: {
          chain: 'eth', address: ADDRESS_A, priceUsd: 3,
          observedAt: loaded.clock.now, source: 'DEXSCREENER', priceProvenance: 'OBSERVED_PRICE'
        }
      })
      : Promise.resolve({ ok: true })
  });
  const context = {
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'REFRESH' },
    quote: {
      chain: 'eth', address: ADDRESS_A, priceUsd: 2,
      observedAt: loaded.clock.now, source: 'GMGN',
      priceObservedAt: loaded.clock.now - loaded.context.Tango.QUOTE_STALE_MS - 1,
      priceSource: 'GMGN', priceProvenance: 'OBSERVED_PRICE'
    }
  };
  loaded.api.runtime.current = context;

  loaded.api.ensureTokenQuote(context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.messages.filter((message) => message.type === 'TANGO_GET_TOKEN_QUOTE').length, 1);
  assert.equal(context.quote.priceUsd, 3);
  assert.equal(context.quote.priceObservedAt, loaded.clock.now);
  assert.equal(context.quote.priceSource, 'DEXSCREENER');
});

test('provisional execution timestamps do not overwrite a factual market-cap observation', () => {
  const loaded = loadContent();
  const factualMarketCapObservedAt = loaded.clock.now - 500;
  const candidate = {
    chain: 'eth', address: ADDRESS_A,
    priceUsd: 3_200 / 1_000_000_000, marketCapUsd: 3_200,
    nativePriceUsd: 1,
    observedAt: loaded.clock.now - 400,
    priceObservedAt: loaded.clock.now - 400,
    marketCapObservedAt: factualMarketCapObservedAt,
    nativePriceObservedAt: loaded.clock.now - 300,
    source: 'TANGO_FALLBACK', valuationMode: 'PRICE',
    priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
    syntheticTokenPrice: true, syntheticNativePrice: true, provisional: true
  };

  const executable = loaded.api.paperExecutableQuote({
    chain: 'eth', address: ADDRESS_A, symbol: 'FALLBACK'
  }, candidate);

  assert.equal(executable.observedAt, loaded.clock.now);
  assert.equal(executable.priceObservedAt, loaded.clock.now);
  assert.equal(executable.marketCapObservedAt, factualMarketCapObservedAt);
  assert.equal(executable.nativePriceObservedAt, loaded.clock.now);
  assert.equal(executable.originalObservedAt, candidate.observedAt);
  assert.equal(executable.nativeOriginalObservedAt, candidate.nativePriceObservedAt);
});

test('delayed confirmation may timestamp a fully deterministic fallback while retaining its audit provenance', async () => {
  const loaded = loadContent();
  loaded.api.runtime.current = {
    token: {
      chain: 'eth', address: ADDRESS_A, symbol: 'FALLBACK',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: {}
  };
  const executionSettings = RealState.normalizeSettings(defaultSettings());
  let committedOrder = null;
  loaded.context.Tango.Store.executeBuy = async (order) => {
    committedOrder = order;
    return RealEngine.executeBuy(loaded.api.runtime.state, order, executionSettings, loaded.clock.now);
  };

  await loaded.api.buy(1);
  const confirm = loaded.api.runtime.modal.action;
  loaded.clock.now += loaded.context.Tango.QUOTE_STALE_MS + 1;
  const executionAt = loaded.clock.now;
  await confirm();

  assert.equal(committedOrder.quote.observedAt, executionAt);
  assert.equal(committedOrder.quote.nativePriceObservedAt, executionAt);
  assert.equal(committedOrder.quote.originalObservedAt, 0);
  assert.equal(committedOrder.quote.nativeOriginalObservedAt, 0);
  assert.equal(committedOrder.quote.syntheticTokenPrice, true);
  assert.equal(committedOrder.quote.syntheticNativePrice, true);
  assert.equal(committedOrder.quote.priceProvenance, 'FALLBACK_INITIAL_MARKET_CAP');
  assert.equal(loaded.api.runtime.state.trades.length, 1);
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
  assert.equal(resolved.calls.buyOrders[0].quote.valuationMode, 'MARKET_CAP');
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
