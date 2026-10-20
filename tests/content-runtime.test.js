const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');

global.Tango = {};
const Chains = require('../src/core/chains.js');
require('../src/shared/i18n.js'); require('../src/shared/format.js');
const DailyReport = require('../src/shared/daily-report.js');
const Supply = require('../src/core/supply.js');
delete global.Tango.Supply;
require('../src/shared/constants.js');
const runtimePaperActions = new WeakMap();
global.Tango.NativeQuickBuyGuard = {
  registerPaperAction(element, _identity, activate) {
    if (typeof activate !== 'function') {
      runtimePaperActions.delete(element);
      return false;
    }
    runtimePaperActions.set(element, activate);
    return true;
  },
  isPaperActionTrusted: () => true,
  revokePaperAction(element) { return runtimePaperActions.delete(element); },
  invokeRegistered(element) { return runtimePaperActions.get(element)?.(); }
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
    openDailyReport, reportAction, renderModal, commitBuy, followQuickBuyDetail, synchronizeAfterBuyDetailPreference, loadAfterBuyDetailPreference, runtime, primeTradeAudio, playTradeSound, start, performRefresh, refresh, refreshRecoverably, performQuoteTick, handleRouteChange, handleQuickBuy, buy, sell, sellPosition, sellBreakeven,
    ensureTokenQuote, ensureNativePrice, freshNativePrice, rememberNativePrice, tickQuote,
    resolvePaperTradeQuote, positionCalibrationUpgrade, queueImmediateCurrentCalibration, paperExecutableQuote,
    requireExecutableQuote, freshExecutableQuote, renderPanel, refreshDetailDisplayQuote: typeof refreshDetailDisplayQuote === 'function' ? refreshDetailDisplayQuote : () => false, floatingScale: typeof floatingScale === 'function' ? floatingScale : () => 1, floatingLayoutStyle: typeof floatingLayoutStyle === 'function' ? floatingLayoutStyle : () => '', bindResizable: typeof bindResizable === 'function' ? bindResizable : () => {}, resetFloatingScale: typeof resetFloatingScale === 'function' ? resetFloatingScale : async () => {}, renderBar, refreshDailyPnl: typeof refreshDailyPnl === 'function' ? refreshDailyPnl : () => {}, renderDrawer, requestCloseAll,
    commitCloseAll, savePresetEdits, constrainFloatingElements, bindEvents, bindDraggable, render, renderHeaderAccountSummary,
    detailRouteToken, routeTokenPlaceholder, ensureRouteTokenContext, acceptedTokenObservation, renderPnlCalendar,
    tokenTradeTotals: typeof tokenTradeTotals === 'function' ? tokenTradeTotals : null,
    chartMarkerPayload, syncChartMarkers, syncQuickBuyButtons, syncTrenchPositionBadges, clearQuickBuyButtons,
    executionValidationTrustContext: typeof executionValidationTrustContext === 'function'
      ? executionValidationTrustContext : null,
    dispatchPageMessage: (data) => handlePageMessage({ source: window, data }),
    dispatchWindowMessage: (event) => handlePageMessage(event)
  };`;
const instrumentedSource = contentSource.replace(START, EXPOSE);

function installTradeAudioHarness(loaded) {
  const calls = { remote: 0, starts: [], resumes: 0 };
  loaded.context.Audio = class {
    play() { calls.remote += 1; return new Promise(() => {}); }
  };
  loaded.context.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 10; this.destination = {}; }
    resume() { calls.resumes += 1; this.state = 'running'; return Promise.resolve(); }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
    createOscillator() {
      const oscillator = { frequency: {}, connect() {}, stop() {},
        start() { calls.starts.push(oscillator.frequency.value); } };
      return oscillator;
    }
  };
  return calls;
}

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
  MutationObserver = class { observe() {} }, matchMedia
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
  const shellListeners = new Map();
  const shell = {
    className: '', innerHTML: '',
    addEventListener(type, listener, options) {
      const entries = shellListeners.get(type) || [];
      entries.push({ listener, options });
      shellListeners.set(type, entries);
    },
    querySelectorAll(selector) { return shellLists.get(selector) || []; }, querySelector() { return null; }
  };
  const shadowLists = new Map();
  const shadowSingles = new Map();
  const shadow = {
    append() {}, addEventListener() {},
    querySelectorAll(selector) { return shadowLists.get(selector) || []; },
    querySelector(selector) { return shadowSingles.get(selector) || null; }
  };
  const hostAttributes = new Map();
  const host = {
    id: '', attachShadow: () => shadow,
    getAttribute: (name) => hostAttributes.get(name) ?? null,
    setAttribute: (name, value) => hostAttributes.set(name, String(value))
  };
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
    URLSearchParams,
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
    matchMedia,
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
    GMGNQuotes, DailyReport,
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
      chainUsdSummary(state, chain, nativePriceUsd, quoteForPosition) {
        calls.chainUsdSummaries.push({ state, chain, nativePriceUsd });
        return RealEngine.chainUsdSummary(state, chain, nativePriceUsd, quoteForPosition);
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
    api, calls, clock, context, host, createDomNode: genericElement, documentSingles, messages, pageMessages,
    shadowLists, shadowSingles, shell, shellLists, shellListeners, windowListeners,
    dispatchStorageChange(changes, areaName = 'local') {
      storageChangeListeners.forEach((listener) => listener(changes, areaName));
    }
  };
}

function chartFrame({
  widgetOptions = '',
  isConnected = true,
  contentDocumentThrows = false
} = {}) {
  const messages = [];
  const listeners = new Map();
  const attributes = new Map();
  if (widgetOptions) attributes.set('data-widget-options', widgetOptions);
  const frame = {
    messages,
    isConnected,
    contentWindow: { postMessage(message) { messages.push(message); } },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    dispatch(type) {
      (listeners.get(type) || []).forEach((listener) => listener({ type, target: frame }));
    }
  };
  if (contentDocumentThrows) {
    Object.defineProperty(frame, 'contentDocument', {
      get() { throw new Error('contentDocument unavailable'); }
    });
  }
  return frame;
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

function chartMarkerMessages(frame) {
  return frame.messages.filter((message) => (
    message?.source === 'TANGO_PAPER_PARENT' && message?.type === 'CHART_MARKERS'
  ));
}

function chartReadyResponse(probe, identity) {
  const data = {
    source: 'TANGO_PAPER_CHART',
    type: 'READY',
    probeId: probe.probeId,
    frameGeneration: probe.frameGeneration
  };
  if (identity) data.identity = identity;
  return data;
}

function chartReadyIdentity(chain, address) {
  return { chain, address };
}

test('throwing contentDocument still receives its own sanitized MCAP frame context', () => {
  const widgetOptions = new URLSearchParams({
    symbol: `eth/${ADDRESS_A}/USD/MCAP`,
    interval: '1',
    workers: JSON.stringify({ enabled: true })
  }).toString();
  const frame = chartFrame({ widgetOptions, contentDocumentThrows: true });
  const loaded = loadContent({ chartFrames: [frame] });

  loaded.api.syncChartMarkers(true);

  const message = chartMarkerMessages(frame).at(-1);
  assert.equal(message.context.axisHint, 'MARKET_CAP');
  assert.equal(Number.isSafeInteger(message.context.frameGeneration), true);
  assert.ok(message.context.frameGeneration > 0);
  assert.equal(typeof message.context.probeId, 'string');
  assert.ok(message.context.probeId.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(message.payload)), { markers: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload)), { markers: [] });
  assert.equal(Object.hasOwn(loaded.api.runtime.latestMarkerPayload, 'axisHint'), false);
  assert.equal(Object.hasOwn(loaded.api.runtime.latestMarkerPayload, 'frameGeneration'), false);
});

test('an exact USD symbol produces a PRICE frame hint', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `eth/${ADDRESS_A}/USD`
    }).toString()
  });
  const loaded = loadContent({ chartFrames: [frame] });

  loaded.api.syncChartMarkers(true);

  assert.equal(chartMarkerMessages(frame).at(-1).context.axisHint, 'PRICE');
});

test('invalid frame metadata yields UNKNOWN without changing canonical markers', async (t) => {
  const cases = [
    {
      name: 'duplicate symbol',
      options: `symbol=eth%2F${ADDRESS_A}%2FUSD&symbol=eth%2F${ADDRESS_A}%2FUSD%2FMCAP`,
      connected: true
    },
    {
      name: 'wrong token',
      options: new URLSearchParams({ symbol: `eth/${ADDRESS_B}/USD/MCAP` }).toString(),
      connected: true
    },
    {
      name: 'ambiguous suffix',
      options: new URLSearchParams({ symbol: `eth/${ADDRESS_A}/USD/MCAP/PRICE` }).toString(),
      connected: true
    },
    {
      name: 'malformed percent encoding',
      options: 'symbol=%E0%A4%A',
      connected: true
    },
    {
      name: 'oversized metadata',
      options: `symbol=${'x'.repeat(8_193)}`,
      connected: true
    },
    {
      name: 'detached frame',
      options: new URLSearchParams({ symbol: `eth/${ADDRESS_A}/USD/MCAP` }).toString(),
      connected: false
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const frame = chartFrame({
        widgetOptions: fixture.options,
        isConnected: fixture.connected
      });
      const loaded = loadContent({ chartFrames: [frame] });
      const before = JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload));

      loaded.api.syncChartMarkers(true);

      const message = chartMarkerMessages(frame).at(-1);
      assert.equal(message.context.axisHint, 'UNKNOWN');
      assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload)), before);
      assert.deepEqual(JSON.parse(JSON.stringify(message.payload)), before);
    });
  }
});

test('same frame re-reads an axis change without mutating or rebuilding canonical markers', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `eth/${ADDRESS_A}/USD/MCAP`
    }).toString()
  });
  const loaded = loadContent({ chartFrames: [frame] });
  loaded.api.syncChartMarkers(true);
  const first = chartMarkerMessages(frame).at(-1);
  const canonical = JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload));

  frame.setAttribute('data-widget-options', new URLSearchParams({
    symbol: `eth/${ADDRESS_A}/USD`
  }).toString());
  loaded.api.syncChartMarkers();

  const messages = chartMarkerMessages(frame);
  const second = messages.at(-1);
  assert.equal(messages.length, 2);
  assert.equal(first.context.axisHint, 'MARKET_CAP');
  assert.equal(second.context.axisHint, 'PRICE');
  assert.equal(second.context.frameGeneration, first.context.frameGeneration);
  assert.deepEqual(JSON.parse(JSON.stringify(second.payload)), canonical);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload)), canonical);
});

test('reused frame metadata for the previous route is UNKNOWN in the new route generation', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `base/${ADDRESS_A}/USD/MCAP`
    }).toString()
  });
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });
  loaded.api.syncChartMarkers(true);
  const firstGeneration = chartMarkerMessages(frame).at(-1).context.frameGeneration;

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();

  const message = chartMarkerMessages(frame).at(-1);
  assert.ok(message.context.frameGeneration > firstGeneration);
  assert.equal(message.context.axisHint, 'UNKNOWN');
  assert.deepEqual(JSON.parse(JSON.stringify(message.payload)), { markers: [] });
});

test('reload advances frame generation and correlated READY replays only the latest token payload', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `base/${ADDRESS_A}/USD/MCAP`
    }).toString()
  });
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'A' },
    quote: {
      priceUsd: 1,
      marketCapUsd: 1_000,
      source: 'GMGN',
      observedAt: loaded.clock.now
    }
  };
  loaded.api.runtime.state.positions[`base:${ADDRESS_A}`] = {
    chain: 'base',
    tokenAddress: ADDRESS_A,
    symbol: 'A',
    quantity: 1,
    averageEntryMarketCap: 1_000,
    averageEntryPriceUsd: 1
  };
  loaded.api.syncChartMarkers(true);
  const firstMessage = chartMarkerMessages(frame).at(-1);
  const firstGeneration = firstMessage.context.frameGeneration;

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.runtime.state.positions[`base:${ADDRESS_B}`] = {
    chain: 'base',
    tokenAddress: ADDRESS_B,
    symbol: 'B',
    quantity: 1,
    averageEntryMarketCap: 2_000,
    averageEntryPriceUsd: 2
  };
  loaded.api.handleRouteChange();
  frame.setAttribute('data-widget-options', new URLSearchParams({
    symbol: `base/${ADDRESS_B}/USD/MCAP`
  }).toString());
  frame.dispatch('load');

  const clearMessage = chartMarkerMessages(frame).at(-1);
  const currentProbe = chartReadyProbes(frame).at(-1);
  assert.ok(clearMessage.context.frameGeneration > firstGeneration);
  assert.equal(clearMessage.context.frameGeneration, currentProbe.frameGeneration);
  assert.deepEqual(JSON.parse(JSON.stringify(clearMessage.payload)), { markers: [] });

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART',
      type: 'READY',
      probeId: currentProbe.probeId,
      frameGeneration: firstGeneration,
      identity: chartReadyIdentity('base', ADDRESS_B)
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(chartMarkerMessages(frame).at(-1).payload)), { markers: [] });

  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_B, symbol: 'B' },
    quote: {
      priceUsd: 2,
      marketCapUsd: 2_000,
      source: 'GMGN',
      observedAt: loaded.clock.now
    }
  };
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: chartReadyResponse(currentProbe, chartReadyIdentity('base', ADDRESS_B))
  });

  const latest = chartMarkerMessages(frame).at(-1);
  assert.equal(latest.context.frameGeneration, currentProbe.frameGeneration);
  assert.equal(latest.context.probeId, currentProbe.probeId);
  assert.equal(latest.payload.tokenAddress, ADDRESS_B);
  assert.equal(latest.payload.markers[0].id, `entry:base:${ADDRESS_B}`);
});

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
  const initialProbe = chartReadyProbes(frame)[0];
  const initialProbeId = initialProbe.probeId;
  assert.equal(typeof initialProbeId, 'string');
  assert.ok(initialProbeId.length > 0);

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      ...chartReadyResponse(initialProbe),
      probeId: `${initialProbeId}:stale`
    }
  });
  assert.equal(loaded.calls.chartReady.length, 0, 'a mismatched response cannot establish trust');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: chartReadyResponse(initialProbe)
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
    data: chartReadyResponse(probe, chartReadyIdentity('eth', ADDRESS_B))
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
    data: chartReadyResponse(rebindProbe, chartReadyIdentity('base', ADDRESS_A))
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
    data: chartReadyResponse(probe, chartReadyIdentity('base', ADDRESS_B))
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
    data: {
      ...chartReadyResponse(routeProbe, chartReadyIdentity('base', ADDRESS_B)),
      probeId: `${routeProbe.probeId}:stale`
    }
  });
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: chartReadyResponse(routeProbe, chartReadyIdentity('base', ADDRESS_A))
  });
  assert.equal(loaded.calls.chartReady.length, 0,
    'untagged, mismatched-probe, and A-identified READY remain rejected');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: chartReadyResponse(routeProbe, chartReadyIdentity('base', ADDRESS_B))
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
    data: chartReadyResponse(routeProbe, chartReadyIdentity('base', ADDRESS_A))
  });
  assert.equal(loaded.calls.chartReady.length, 0,
    'identityless and A-identified READY cannot promote the rebound frame');

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: chartReadyResponse(routeProbe, chartReadyIdentity('base', ADDRESS_B))
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
    data: chartReadyResponse(firstProbe, chartReadyIdentity('base', ADDRESS_B))
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
    data: chartReadyResponse(probe, chartReadyIdentity('base', ADDRESS_A))
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
    data: chartReadyResponse(probe, chartReadyIdentity('base', ADDRESS_A))
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
    data: chartReadyResponse(probe, chartReadyIdentity('base', ADDRESS_B))
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
      data: chartReadyResponse(chartReadyProbes(frame)[0])
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
    type: 'childList', target: { nodeType: 1, tagName: 'BODY' },
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
    data: chartReadyResponse(routeProbe, chartReadyIdentity('eth', ADDRESS_A))
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
    data: chartReadyResponse(routeProbe, chartReadyIdentity('eth', ADDRESS_A))
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
    data: chartReadyResponse(probe, chartReadyIdentity('eth', ADDRESS_A))
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
  const handle = eventElement();
  const element = eventElement();
  element.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 100 });
  loaded.shellLists.set('[data-action]', [save, confirm]);
  loaded.shellLists.set('.tango-preset-editor', [editor]);
  loaded.shadowSingles.set('#tango-skip-session-confirm', checkbox);
  loaded.shadowSingles.set('[data-drag-handle]', handle);
  loaded.shadowSingles.set('.tango-panel', element);
  setPresetInputs(loaded);
  loaded.api.runtime.modal = { type: 'confirm', title: 'Confirm', rows: [], allowSessionSuppress: true, action: async () => undefined };
  loaded.api.bindEvents();

  const synthetic = {
    isTrusted: false, key: 'Enter',
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  };
  checkbox.emit('change', synthetic);
  await save.emit('click', synthetic);
  await editor.emit('keydown', synthetic);
  await confirm.emit('click', synthetic);
  handle.emit('pointerdown', { ...synthetic, target: { closest: () => null }, clientX: 10, clientY: 10 });

  assert.equal(loaded.windowListeners.has('pointermove'), false);
  assert.equal(loaded.calls.patches.length, 0);
  assert.equal(loaded.messages.some((message) => message.type === 'TANGO_SET_SESSION_CONFIRM'), false);
  assert.equal(loaded.api.runtime.suppressConfirmForSession, false);
  assert.equal(checkbox.checked, false);

  const trusted = { ...synthetic, isTrusted: true };
  handle.emit('pointerdown', { ...trusted, target: { closest: () => null }, clientX: 10, clientY: 10 });
  loaded.windowListeners.get('pointermove')({ ...synthetic, clientX: 30, clientY: 40 });
  await loaded.windowListeners.get('pointerup')(synthetic);

  assert.equal(loaded.api.runtime.settings.panelPosition, null);
  assert.equal(loaded.calls.patches.length, 0);
});

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
  loaded.api.runtime.modal = { type: 'confirm', title: 'Confirm', rows: [], allowSessionSuppress: true, action: async () => undefined };
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

test('shell capture gate blocks every synthetic mutation event and admits trusted events', () => {
  const loaded = loadContent();
  const captureListeners = (type) => (loaded.shellListeners.get(type) || [])
    .filter(({ options }) => options?.capture === true || options === true);
  const event = (isTrusted) => {
    const calls = { prevented: 0, stopped: 0, immediate: 0 };
    return {
      isTrusted,
      preventDefault() { calls.prevented += 1; },
      stopPropagation() { calls.stopped += 1; },
      stopImmediatePropagation() { calls.immediate += 1; },
      calls
    };
  };

  for (const type of ['click', 'keydown', 'change', 'pointerdown']) {
    const synthetic = event(false);
    captureListeners(type).forEach(({ listener }) => listener(synthetic));
    assert.deepEqual(synthetic.calls, { prevented: 1, stopped: 1, immediate: 1 }, type);

    const trusted = event(true);
    captureListeners(type).forEach(({ listener }) => listener(trusted));
    assert.deepEqual(trusted.calls, { prevented: 0, stopped: 0, immediate: 0 }, type);
  }
  assert.equal(loaded.api.runtime.interactionUntil, loaded.clock.now + 500);
});

test('synthetic direct position and header handlers cannot mutate shell state', async () => {
  const loaded = loadContent();
  const position = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 1,
    costBasisNative: 1, averageEntryPriceUsd: 2, lastPriceUsd: 2,
    lastNativePriceUsd: 2_000, quoteObservedAt: loaded.clock.now
  };
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = position;
  const open = eventElement({ dataset: { key: `eth:${ADDRESS_A}` } });
  const sell = eventElement({ dataset: { key: `eth:${ADDRESS_A}`, positionSell: '100' } });
  loaded.shellLists.set('[data-position-open]', [open]);
  loaded.shellLists.set('[data-position-sell]', [sell]);
  const anchor = loaded.createDomNode();
  loaded.documentSingles.set('[data-testid="header-actions"]', anchor);
  loaded.api.renderHeaderAccountSummary({});
  const header = loaded.documentSingles.get('#tango-header-account-summary');
  loaded.api.bindEvents();

  const synthetic = (key = '') => {
    const calls = { prevented: 0, stopped: 0, immediate: 0 };
    return {
      isTrusted: false, key,
      preventDefault() { calls.prevented += 1; },
      stopPropagation() { calls.stopped += 1; },
      stopImmediatePropagation() { calls.immediate += 1; },
      calls
    };
  };
  const openEvent = synthetic();
  const sellEvent = synthetic();
  const clickEvent = synthetic();
  const enterEvent = synthetic('Enter');
  const spaceEvent = synthetic(' ');
  open.emit('click', openEvent);
  await sell.emit('click', sellEvent);
  header.onclick(clickEvent);
  header.onkeydown(enterEvent);
  header.onkeydown(spaceEvent);

  assert.equal(loaded.messages.some((message) => message.type === 'TANGO_OPEN_TOKEN'), false);
  assert.equal(loaded.calls.sell, 0);
  assert.equal(loaded.api.runtime.calendarOpen, false);
  for (const item of [openEvent, sellEvent, clickEvent, enterEvent, spaceEvent]) {
    assert.deepEqual(item.calls, { prevented: 1, stopped: 1, immediate: 1 });
  }
});

test('trusted buy sell position header and drag handlers preserve shell behavior', async () => {
  const loaded = loadContent();
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('eth', 2_000, loaded.clock.now);
  seedHeldDetailPosition(loaded);
  const buy = eventElement({ dataset: { buy: '1' } });
  const sell = eventElement({ dataset: { sell: '100' } });
  const openPosition = eventElement({ dataset: { key: `eth:${ADDRESS_A}` } });
  const sellPosition = eventElement({ dataset: { key: `eth:${ADDRESS_A}`, positionSell: '25' } });
  const handle = eventElement();
  const panel = eventElement();
  panel.getBoundingClientRect = () => ({ left: 100, top: 100, width: 200, height: 100 });
  loaded.shellLists.set('[data-buy]', [buy]);
  loaded.shellLists.set('[data-sell]', [sell]);
  loaded.shellLists.set('[data-position-open]', [openPosition]);
  loaded.shellLists.set('[data-position-sell]', [sellPosition]);
  loaded.shadowSingles.set('[data-drag-handle]', handle);
  loaded.shadowSingles.set('.tango-panel', panel);
  const anchor = loaded.createDomNode();
  loaded.documentSingles.set('[data-testid="header-actions"]', anchor);
  loaded.api.renderHeaderAccountSummary({});
  const header = loaded.documentSingles.get('#tango-header-account-summary');
  loaded.api.bindEvents();

  const trusted = (key = '') => {
    const calls = { prevented: 0, stopped: 0, immediate: 0 };
    return {
      isTrusted: true, key,
      preventDefault() { calls.prevented += 1; },
      stopPropagation() { calls.stopped += 1; },
      stopImmediatePropagation() { calls.immediate += 1; },
      calls
    };
  };
  await buy.emit('click', trusted());
  await sell.emit('click', trusted());
  openPosition.emit('click', trusted());
  await Promise.resolve();
  await sellPosition.emit('click', trusted());
  const headerClick = trusted();
  assert.equal(loaded.api.runtime.calendarOpen, false);
  header.onclick(headerClick);
  assert.equal(loaded.api.runtime.calendarOpen, true);
  assert.deepEqual(headerClick.calls, { prevented: 1, stopped: 1, immediate: 0 });
  const headerEnter = trusted('Enter');
  assert.equal(loaded.api.runtime.calendarOpen, true);
  header.onkeydown(headerEnter);
  assert.equal(loaded.api.runtime.calendarOpen, false);
  assert.equal(headerEnter.calls.prevented, 1);
  const headerSpace = trusted(' ');
  assert.equal(loaded.api.runtime.calendarOpen, false);
  header.onkeydown(headerSpace);
  assert.equal(loaded.api.runtime.calendarOpen, true);
  assert.equal(headerSpace.calls.prevented, 1);
  handle.emit('pointerdown', { ...trusted(), target: { closest: () => null }, clientX: 10, clientY: 10 });
  loaded.windowListeners.get('pointermove')({ ...trusted(), clientX: 30, clientY: 40 });
  await loaded.windowListeners.get('pointerup')(trusted());

  assert.equal(loaded.calls.buyOrders[0].amountNative, 1);
  assert.equal(loaded.calls.sellOrders.length, 2);
  assert.equal(loaded.calls.sellOrders[0].percent, 100);
  assert.equal(loaded.calls.sellOrders[1].percent, 25);
  assert.equal(loaded.api.runtime.tradePending, false);
  assert.equal(loaded.api.runtime.toast.type, 'success');
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.messages.find((message) => message.type === 'TANGO_OPEN_TOKEN'))), {
    type: 'TANGO_OPEN_TOKEN', url: `https://gmgn.ai/eth/token/${ADDRESS_A}`
  });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.settings.panelPosition)), { x: 120, y: 130 });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls.patches)), [{ panelPosition: { x: 120, y: 130 } }]);
  assert.equal(panel.style.left, '120px');
  assert.equal(panel.style.top, '130px');
});

test('trusted confirmation cannot suppress the session without trusted checkbox provenance', async () => {
  const loaded = loadContent();
  const confirm = eventElement({ dataset: { action: 'confirm-modal' } });
  const checkbox = eventElement({ checked: true });
  let modalActions = 0;
  loaded.shellLists.set('[data-action]', [confirm]);
  loaded.shadowSingles.set('#tango-skip-session-confirm', checkbox);
  loaded.api.runtime.modal = {
    type: 'confirm', title: 'Confirm', rows: [], allowSessionSuppress: true,
    action: async () => { modalActions += 1; }
  };
  loaded.api.bindEvents();

  await confirm.emit('click', {
    isTrusted: true,
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  });

  assert.equal(modalActions, 1);
  assert.equal(loaded.messages.some((message) => (
    message.type === 'TANGO_SET_SESSION_CONFIRM' && message.suppressed === true
  )), false);
  assert.equal(loaded.api.runtime.suppressConfirmForSession, false);
});

test('content preset click contains persistence rejection', async () => {
  const loaded = loadContent({ patchSettings: async () => { throw new Error('write failed'); } });
  const saveButton = eventElement({ dataset: { action: 'save-presets' } });
  loaded.shellLists.set('[data-action]', [saveButton]);
  setPresetInputs(loaded);
  loaded.api.bindEvents();

  const rejection = await saveButton.emit('click', { isTrusted: true, stopPropagation() {} }).then(() => null, (error) => error);

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

    const rejection = await button.emit('click', { isTrusted: true, stopPropagation() {} }).then(() => null, (error) => error);

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
    isTrusted: true,
    target: { closest: () => null },
    clientX: 10,
    clientY: 10
  });
  loaded.windowListeners.get('pointermove')({ isTrusted: true, clientX: 30, clientY: 40, preventDefault() {} });
  const rejection = await loaded.windowListeners.get('pointerup')({ isTrusted: true }).then(() => null, (error) => error);

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
  loaded.api.rememberNativePrice('eth', 200, loaded.clock.now);
  loaded.api.runtime.drawerOpen = true;
  const summary = loaded.context.Tango.Engine.portfolioSummary(loaded.api.runtime.state, 'eth');
  const usdSummary = loaded.context.Tango.Engine.chainUsdSummary(loaded.api.runtime.state, 'eth', 200);
  loaded.calls.chainUsdSummaries.length = 0;

  const bar = loaded.api.renderBar(summary);
  assert.equal(loaded.calls.chainUsdSummaries.length, 0, 'daily bar does not scan portfolio totals');
  const drawer = loaded.api.renderDrawer(summary);
  loaded.api.requestCloseAll();

  assert.equal(usdSummary.assetsUsd, 1_900);
  assert.equal(usdSummary.pnlUsd, -100);
  assert.match(bar, /\$0/);
  assert.doesNotMatch(bar, /\$1900|\$2000|-\$100/);
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
  loaded.api.rememberNativePrice('eth', 200, loaded.clock.now);
  loaded.api.runtime.drawerOpen = true;
  const summary = loaded.context.Tango.Engine.portfolioSummary(loaded.api.runtime.state, 'eth', 200);

  const bar = loaded.api.renderBar(summary);
  const drawer = loaded.api.renderDrawer(summary);
  loaded.api.requestCloseAll();

  assert.match(bar, /0 ETH/);
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
  loaded.api.rememberNativePrice('eth', 200, loaded.clock.now);
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

  const saving = editor.emit('keydown', { isTrusted: true, key: 'Enter' });

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

test('secondary quick sells route to existing same-token paper sells and reject unavailable positions', async () => {
  for (const mode of ['percent', 'breakeven', 'missing', 'unrecoverable', 'unknown']) {
    const loaded = loadContent();
    loaded.api.runtime.settings.confirmationEnabled = false;
    const context = quoteContext();
    const position = {
      chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 2,
      costBasisNative: 1, lastPriceUsd: 2, lastMarketCapUsd: 2000, lastNativePriceUsd: 3000,
      quoteObservedAt: loaded.clock.now
    };
    if (mode !== 'missing') loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = position;
    loaded.api.runtime.current = context;
    loaded.api.rememberNativePrice('eth', 3000, loaded.clock.now);
    loaded.context.Tango.Engine.breakevenSellPercent = () => mode === 'unrecoverable' ? null : 50;
    await loaded.api.handleQuickBuy({
      ...context, amountNative: 1, side: mode === 'unknown' ? 'UNKNOWN' : 'SELL',
      sellPercent: 25, breakeven: mode === 'breakeven' || mode === 'unrecoverable'
    });
    assert.equal(loaded.calls.buy, 0, mode);
    if (mode === 'percent' || mode === 'breakeven') {
      assert.equal(loaded.calls.sell, 1, mode);
      assert.equal(loaded.calls.sellOrders[0].percent, mode === 'percent' ? 25 : 50);
      assert.equal(loaded.calls.sellOrders[0].breakeven, mode === 'breakeven' ? true : undefined);
      assert.equal(loaded.calls.sellOrders[0].token.address, ADDRESS_A);
    } else assert.equal(loaded.calls.sell, 0, mode);
  }
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
    href: 'https://gmgn.ai/?chain=eth',
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
      global.Tango.NativeQuickBuyGuard.invokeRegistered(paper);
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

test('pending settings and master OFF block every sell and close confirmation path', async (t) => {
  for (const enabled of [false, true]) {
    for (const kind of ['sell', 'drawer', 'breakeven', 'close']) {
      await t.test(`${kind}: settings update enabled=${enabled}`, async () => {
        const loaded = loadContent();
        const position = {
          chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', quantity: 2,
          costBasisNative: 1, lastPriceUsd: 2, lastMarketCapUsd: 2_000, lastNativePriceUsd: 3_000,
          quoteObservedAt: loaded.clock.now
        };
        loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = position;
        loaded.api.runtime.current = quoteContext();
        loaded.api.rememberNativePrice('eth', 3_000, loaded.clock.now);
        loaded.context.Tango.Engine.breakevenSellPercent = () => 50;
        const invoke = kind === 'sell' ? () => loaded.api.sell(50)
          : kind === 'drawer' ? () => loaded.api.sellPosition(position, 50)
          : kind === 'breakeven' ? () => loaded.api.sellBreakeven()
          : () => loaded.api.requestCloseAll();
        await invoke();
        const oldModal = loaded.api.runtime.modal;
        assert.equal(oldModal?.type, 'confirm');
        const confirm = eventElement({ dataset: { action: 'confirm-modal' } });
        loaded.shellLists.set('[data-action]', [confirm]);
        loaded.api.bindEvents();
        loaded.dispatchStorageChange({
          [global.Tango.SETTINGS_KEY]: { newValue: { ...defaultSettings(), enabled } }
        });
        assert.equal(loaded.api.runtime.quickBuySettingsPending, true);
        await oldModal.action();
        await confirm.emit('click', { isTrusted: true, stopPropagation() {} });
        await invoke();
        assert.equal(loaded.calls.sell, 0);
        assert.equal(loaded.calls.closeAll, 0);
        assert.equal(loaded.api.runtime.tradePending, false);
        assert.equal(loaded.api.runtime.modal, oldModal);
      });
    }
  }
});

test('malformed page-message batches are ignored and subsequent valid observations still work', () => {
  const loaded = loadContent();
  const before = loaded.api.runtime.gmgnQuotes.size;
  const badScalar = structuredClone({ toString: null, valueOf: null });
  for (const prices of [{}, 'bad', null, [null, [], 123, 'bad']]) {
    assert.doesNotThrow(() => loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES', prices }));
  }
  for (const quotes of [{}, 'bad', null, [null, [], 123, 'bad']]) {
    assert.doesNotThrow(() => loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes }));
  }
  assert.equal(loaded.api.runtime.gmgnQuotes.size, before);
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES',
    prices: [null, { symbol: 'ETH', priceUsd: badScalar, observedAt: loaded.clock.now },
      { symbol: 'ETH', priceUsd: 2_500, observedAt: loaded.clock.now }]
  });
  assert.equal(loaded.api.freshNativePrice('eth'), 2_500);
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [null,
      { ...detailQuote(8_000, loaded.clock.now), priceUsd: badScalar },
      detailQuote(8_000, loaded.clock.now)]
  });
  assert.equal(loaded.api.runtime.gmgnQuotes.size, before + 1);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
});

test('content theme follows explicit light/dark settings and auto system changes', () => {
  let systemLight = true;
  let listener;
  const loaded = loadContent({ matchMedia: () => ({
    get matches() { return systemLight; }, addEventListener(_type, callback) { listener = callback; }
  }) });
  loaded.context.Tango.I18n.resolveTheme = (setting) => setting === 'auto'
    ? (systemLight ? 'light' : 'dark') : setting;
  const headerAttributes = new Map();
  loaded.documentSingles.set('#tango-header-account-summary', {
    getAttribute: (name) => headerAttributes.get(name),
    setAttribute: (name, value) => headerAttributes.set(name, value), remove() {}
  });
  loaded.api.runtime.settings.theme = 'light';
  loaded.api.render();
  assert.equal(loaded.host.getAttribute('data-theme'), 'light');
  assert.equal(headerAttributes.get('data-theme'), 'light');
  loaded.api.runtime.settings.theme = 'dark';
  loaded.api.render();
  assert.equal(loaded.host.getAttribute('data-theme'), 'dark');
  loaded.api.runtime.settings.theme = 'auto';
  loaded.api.render();
  assert.equal(loaded.host.getAttribute('data-theme'), 'light');
  systemLight = false; listener();
  assert.equal(loaded.host.getAttribute('data-theme'), 'dark');
  assert.equal(headerAttributes.get('data-theme'), 'dark');
});

test('USD arithmetic overflow degrades the overlay without hiding local account rendering', () => {
  const loaded = loadContent();
  loaded.api.runtime.settings.displayCurrency = 'USD';
  loaded.api.runtime.state.accounts.eth.initialBalanceNative = 1e15;
  loaded.api.runtime.state.accounts.eth.cashBalanceNative = 1e15;
  loaded.api.rememberNativePrice('eth', 1e308, loaded.clock.now);
  assert.doesNotThrow(() => loaded.api.render());
  assert.match(loaded.shell.innerHTML, /tango-bar/);
  assert.doesNotMatch(loaded.shell.innerHTML, /Infinity|NaN/);
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
    assert.equal(
      global.Tango.NativeQuickBuyGuard.invokeRegistered(harness.replacement)?.status,
      'REJECTED'
    );
    assert.equal(RealGMGN._quickBuyIntentCount(), 0);
    assert.equal(loaded.calls.buy, 0);
    assert.equal(loaded.api.runtime.modal, null);
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
  let resizeObserverCreates = 0;
  class CapturingMutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe(_target, options) { observerOptions = options; }
  }
  class CapturingResizeObserver {
    constructor() { resizeObserverCreates += 1; }
    observe() {}
    unobserve() {}
    disconnect() {}
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
    assert.equal(harness.slot.dataset.tangoTokenAddress, ADDRESS_A);

    harness.setAddress(ADDRESS_B);
    flushMutation([
      { type: 'attributes', target: harness.identityNode, attributeName: 'href' },
      { type: 'characterData', target: harness.identityText }
    ]);

    assert.equal(firstControl.isConnected, false);
    assert.notEqual(harness.slot.dataset.tangoActionId, firstActionId);
    assert.equal(global.Tango.NativeQuickBuyGuard.invokeRegistered(firstControl), undefined);
    assert.equal(harness.slot.dataset.tangoBindingKey, `base:${ADDRESS_B}`);
    assert.equal(harness.slot.dataset.tangoTokenAddress, ADDRESS_B);
    assert.equal(harness.paperControlCount, 1);
    assert.equal(harness.replacement.className, 'tango-list-quick-buy');
    assert.equal(harness.replacement.dataset.tangoQuickBuySize, 'giant');
    assert.equal(harness.replacement.dataset.tangoPublished, '1');
    assert.equal(harness.replacement.style.cssText, '');
    assert.equal(harness.slot.dataset.tangoQuickBuySize, 'giant');
    await global.Tango.NativeQuickBuyGuard.invokeRegistered(harness.replacement);
    assert.equal(loaded.api.runtime.modal?.type, 'confirm');
    assert.equal(resizeObserverCreates, 0);
    assert.equal(harness.nativeControl.restored, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(observerOptions)), {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['href', 'class', 'style', 'data-testid', 'data-addr', 'data-address', 'data-token-address', 'data-symbol'], attributeOldValue: true,
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

test('page NATIVE_PRICES stay display-only after the next real quote tick', async () => {
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
  loaded.context.Tango.Store.updatePositionMetadata = async () => loaded.api.runtime.state;

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES',
    prices: [{ symbol: 'ETH', priceUsd: 2_000, observedAt: loaded.clock.now }]
  });
  assert.equal(loaded.api.runtime.persistentNativePrices.has('eth'), false);
  assert.equal(loaded.api.runtime.nativePrices.get('eth'), 2_000,
    'page price remains available to display and decision caches');

  await loaded.api.performQuoteTick();

  assert.equal(loaded.calls.updatePositionQuotes.length, 0,
    'a later tick must not launder a page observation into Store');
});

test('page NATIVE_PRICES cannot suppress the background authority refresh', async () => {
  let loaded;
  loaded = loadContent({
    sendMessage: async (message) => message.type === 'TANGO_GET_NATIVE_PRICE'
      ? { ok: true, price: 2_100, observedAt: loaded.clock.now }
      : { ok: true }
  });
  const context = quoteContext();
  loaded.api.runtime.current = context;
  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES',
    prices: [{ symbol: 'ETH', priceUsd: 2_000, observedAt: loaded.clock.now }]
  });

  loaded.api.ensureNativePrice(context);
  const refresh = loaded.api.runtime.nativePricePromises.get('eth');

  assert.ok(refresh, 'display-only page cache must not satisfy extension authority');
  await refresh;
  assert.equal(loaded.api.runtime.persistentNativePrices.get('eth'), 2_100);
  assert.equal(context.quote.nativePriceUsd, 2_100);
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

test('no-chart history survives coordinator partial sells and drawer/detail/close-all paths', async () => {
  for (const totalSupply of [0, 1_000_000_000]) {
    for (const exitPath of ['detail', 'drawer', 'close-all']) {
      const loaded = loadContent({ href: `https://gmgn.ai/bsc/token/${ADDRESS_A}` });
      const token = { chain: 'bsc', address: ADDRESS_A, symbol: 'NEW' };
      loaded.api.rememberNativePrice('bsc', 700, loaded.clock.now);
      const settings = RealState.normalizeSettings({ fastMode: false, confirmationEnabled: true,
        slippageBps: 0, platformFeeBps: 0, chains: { bsc: { networkFeeNative: 0 } } });
      const initial = RealState.createInitialState({ now: 1, initialBalances: { bsc: 10 } });
      initial.initialized = true;
      const values = { [global.Tango.STORAGE_KEY]: initial, [global.Tango.SETTINGS_KEY]: settings };
      const coordinator = StateCoordinator.create({
        async readRaw(keys) { return Object.fromEntries(keys.filter(k => k in values).map(k => [k, structuredClone(values[k])])); },
        async writeRaw(next) { Object.assign(values, structuredClone(next)); },
        now: () => loaded.clock.now
      });
      const entry = loaded.api.resolvePaperTradeQuote(token, { chain: 'bsc', address: ADDRESS_A,
        priceUsd: 0.0000031, marketCapUsd: 0, totalSupply,
        supplySource: totalSupply ? 'GMGN_EXACT' : '', source: 'GMGN_DETAIL',
        observedAt: loaded.clock.now, priceObservedAt: loaded.clock.now });
      const bought = await coordinator.mutate(structuredClone({ type: 'EXECUTE_BUY',
        order: { token, quote: entry, amountNative: 0.1 } }));
      loaded.api.runtime.state = bought.state;
      loaded.api.runtime.settings = settings;
      loaded.context.Tango.Engine = RealEngine;
      loaded.context.Tango.ChainView = require('../src/content/chain-view.js');
      loaded.context.Tango.Store.executeSell = order => coordinator.mutate(structuredClone({ type: 'EXECUTE_SELL', order }));
      loaded.context.Tango.Store.executeCloseAll = (chain, orders) => coordinator.mutate(structuredClone({ type: 'EXECUTE_CLOSE_ALL', chain, orders }));
      loaded.clock.now += 60_000;
      const candidate = { chain: 'bsc', address: ADDRESS_A, priceUsd: 0, marketCapUsd: 0,
        totalSupply, supplySource: totalSupply ? 'GMGN_EXACT' : '', source: 'GMGN_DETAIL',
        observedAt: loaded.clock.now, priceObservedAt: 0 };
      loaded.api.runtime.current = { token, quote: candidate };
      // The preview can be factual, then expire while the confirmation is open.
      loaded.api.runtime.current.quote = { ...entry, observedAt: loaded.clock.now,
        priceObservedAt: loaded.clock.now, source: 'GMGN_DETAIL', syntheticTokenPrice: false };
      const key = RealEngine.positionKey('bsc', ADDRESS_A);
      await loaded.api.sell(50);
      loaded.clock.now += 60_000;
      loaded.api.runtime.current.quote = candidate;
      await loaded.api.runtime.modal.action();
      const remaining = loaded.api.runtime.state.positions[key];
      assert.ok(Math.abs(remaining.quantity - bought.position.quantity / 2) < 1e-8, `${totalSupply}:${exitPath}: half quantity`);
      assert.ok(Math.abs(loaded.api.runtime.state.accounts.bsc.cashBalanceNative - 9.95) < 1e-10);
      const nextQuote = loaded.api.resolvePaperTradeQuote(token, candidate, { position: remaining });
      assert.equal(nextQuote.priceUsd, entry.priceUsd, `${totalSupply}:${exitPath}: no invented price drift`);
      if (exitPath === 'drawer') await loaded.api.sellPosition(remaining, 100);
      else if (exitPath === 'close-all') await loaded.api.commitCloseAll();
      else await loaded.api.sell(100);
      if (exitPath !== 'close-all') {
        loaded.clock.now += 60_000;
        await loaded.api.runtime.modal.action();
      }
      const final = loaded.api.runtime.state;
      assert.equal(Object.keys(final.positions).length, 0, `${totalSupply}:${exitPath}: closed`);
      assert.ok(Math.abs(final.accounts.bsc.cashBalanceNative - 10) < 1e-10, `${totalSupply}:${exitPath}: exact proceeds`);
      assert.doesNotThrow(() => RealState.normalizeState(structuredClone(final), settings, { strict: true }));
      const sells = final.trades.filter(trade => trade.side === 'SELL');
      assert.equal(sells.length, 2);
      assert.ok(sells.every(trade => trade.syntheticTokenPrice === true), JSON.stringify({ totalSupply, exitPath, sells }));
      assert.equal(RealMarkers.buildPayload({ current: { token, quote: nextQuote }, position: null,
        trades: sells, labels: { entry: 'BUY', exit: 'SELL' } }).markers.length, 0);
    }
  }
});

test('no-chart zero-price observations can sell using explicitly provisional position history', () => {
  const loaded = loadContent({ href: `https://gmgn.ai/bsc/token/${ADDRESS_A}` });
  const token = { chain: 'bsc', address: ADDRESS_A, symbol: 'NEW' };
  loaded.api.rememberNativePrice('bsc', 700, loaded.clock.now);
  const settings = RealState.normalizeSettings({ slippageBps: 0, platformFeeBps: 0,
    chains: { bsc: { networkFeeNative: 0 } } });
  const initial = RealState.createInitialState({ now: 1, initialBalances: { bsc: 10 } });
  initial.initialized = true;
  const entryQuote = loaded.api.resolvePaperTradeQuote(token, {
    chain: 'bsc', address: ADDRESS_A, priceUsd: 0.0000031, marketCapUsd: 0,
    totalSupply: 1_000_000_000, supplySource: 'GMGN_EXACT', source: 'GMGN_DETAIL',
    observedAt: loaded.clock.now, priceObservedAt: loaded.clock.now
  });
  const bought = RealEngine.executeBuy(initial, { token, quote: entryQuote, amountNative: 0.1 },
    settings, loaded.clock.now);
  loaded.api.runtime.state = bought.state;
  loaded.clock.now += 60_000;
  const candidate = { chain: 'bsc', address: ADDRESS_A, priceUsd: 0, marketCapUsd: 0,
    totalSupply: 1_000_000_000, supplySource: 'GMGN_EXACT', source: 'GMGN_DETAIL',
    observedAt: loaded.clock.now, priceObservedAt: 0 };
  const quote = loaded.api.resolvePaperTradeQuote(token, candidate, { position: bought.position });
  assert.equal(quote.valuationSource, 'POSITION_HISTORY');
  const half = RealEngine.executeSell(bought.state, { token, quote, percent: 50 }, settings, loaded.clock.now);
  assert.ok(Math.abs(half.position.quantity - bought.position.quantity / 2) < 1e-8);
  assert.ok(Math.abs(half.trade.amountNative - 0.05) < 1e-10);
  assert.equal(quote.syntheticTokenPrice, true, 'history must not masquerade as a fresh chart price');
  assert.equal(quote.provisional, true);
  loaded.api.runtime.state = half.state;
  const nextQuote = loaded.api.resolvePaperTradeQuote(token, candidate, { position: half.position });
  assert.equal(nextQuote.priceUsd, quote.priceUsd, 'separate sells must retain the same historical price');
  const markers = RealMarkers.buildPayload({ current: { token, quote: nextQuote },
    position: null, trades: [half.trade], labels: { entry: 'BUY', exit: 'SELL' } });
  assert.equal(markers.markers.length, 0, 'historical fills must not fabricate chart coordinates');
  const full = RealEngine.executeSell(half.state, { token, quote: nextQuote, percent: 100 }, settings, loaded.clock.now);
  assert.equal(Object.keys(full.state.positions).length, 0);
  assert.ok(Math.abs(full.state.accounts.bsc.cashBalanceNative - 10) < 1e-10);
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

test('an exact GMGN page supply stays ephemeral inside the mark throttle', async () => {
  const key = `base:${ADDRESS_A}`;
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    requestAnimationFrame: (callback) => { callback(); return 1; }
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

  assert.equal(loaded.api.runtime.gmgnQuotes.get(key).totalSupply, 1_000_000_000);
  assert.equal(loaded.api.runtime.current.quote.totalSupply, 1_000_000_000);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
  assert.equal(loaded.api.runtime.state.positions[key].quantity, 100);
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
  loaded.api.runtime.persistentGmgnQuotes.set(key, {
    ...loaded.api.runtime.current.quote, chain: 'base', address: ADDRESS_A
  });
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

test('a stronger background native observation during supply calibration reruns immediately after settlement', async () => {
  const key = `base:${ADDRESS_A}`;
  const firstWrite = deferred();
  const secondWrite = deferred();
  let writeIndex = 0;
  let loaded;
  loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    sendMessage(message) {
      if (message.type === 'TANGO_GET_NATIVE_PRICE') {
        return Promise.resolve({ ok: true, price: 2_000, observedAt: loaded.clock.now });
      }
      return Promise.resolve({ ok: true });
    },
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
  loaded.api.runtime.persistentGmgnQuotes.set(key, {
    ...loaded.api.runtime.current.quote, chain: 'base', address: ADDRESS_A
  });
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
  loaded.api.ensureNativePrice(loaded.api.runtime.current);
  await loaded.api.runtime.nativePricePromises.get('base');
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

test('page supply-only observations update cache and display without rewriting synthetic positions', async () => {
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

  assert.equal(loaded.api.runtime.gmgnQuotes.get(key).totalSupply, 1_000_000_000);
  assert.equal(loaded.api.runtime.current.quote.totalSupply, 1_000_000_000);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
  assert.equal(loaded.api.runtime.state.positions[key].syntheticTokenPrice, true);

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

  assert.equal(loaded.api.runtime.gmgnQuotes.get(key).priceUsd, 2);
  assert.equal(loaded.api.runtime.current.quote.priceUsd, 2);
  assert.equal(loaded.api.runtime.persistentGmgnQuotes.has(key), false);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
  assert.equal(loaded.api.runtime.state.positions[key].syntheticNativePrice, true);
});

test('a background native-price response immediately calibrates the current position without timer advancement', async () => {
  const key = `base:${ADDRESS_A}`;
  let loaded;
  loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    requestAnimationFrame: (callback) => { callback(); return 1; },
    sendMessage(message) {
      if (message.type === 'TANGO_GET_NATIVE_PRICE') {
        return Promise.resolve({ ok: true, price: 2_000, observedAt: loaded.clock.now });
      }
      return Promise.resolve({ ok: true });
    }
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

  loaded.api.ensureNativePrice(loaded.api.runtime.current);
  await loaded.api.runtime.nativePricePromises.get('base');
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

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 2);
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 4_300);
  assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, 4_300 / 1_000_000_000);
});

test('detail commit immediately falls back when the verified DOM snapshot is unavailable', async () => {
  const loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => null });
  seedHeldDetailPosition(loaded, 3_750);

  const action = loaded.api.sell(100);

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 2);
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

test('detail confirmation uses the current DOM snapshot for preview and rechecks on commit', async () => {
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

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 1);
  assert.deepEqual(Array.from(loaded.api.runtime.modal.rows, (row) => Array.from(row))
    .filter(([key]) => key === 'observedPrice'), [['observedPrice', '$0.0000043']]);
  const confirm = loaded.api.runtime.modal.action;
  await confirm();
  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 2);
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

  assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 2);
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 3_750);
});

test('unusable detail snapshots retain the latest trusted same-token fallback', async (t) => {
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

      assert.equal(loaded.calls.readVerifiedCurrentTokenSnapshot, 2);
      assert.equal(loaded.calls.sell, 1);
      assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 3_900);
      assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, 3_900 / 1_000_000_000);
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

test('page TOKEN_QUOTES remain ephemeral and cannot persist metadata or calibration', async () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  const key = `eth:${ADDRESS_A}`;
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.state.positions[key] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'OLD', name: 'Old', quantity: 1,
    costBasisNative: 1, averageEntryMarketCap: 500, averageEntryPriceUsd: 0.0000005,
    lastPriceUsd: 0.0000005, lastMarketCapUsd: 500,
    lastNativePriceUsd: 2_000, quoteObservedAt: loaded.clock.now - 1,
    totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    valuationMode: 'MARKET_CAP', averageEntryPriceProvenance: 'MARKET_CAP_DERIVED',
    needsCalibration: true, provisional: true, syntheticTokenPrice: true
  };
  loaded.api.runtime.state.trades = [{
    id: 'buy-page-ephemeral', chain: 'eth', tokenAddress: ADDRESS_A, side: 'BUY',
    marketCapUsd: 500, observedPriceUsd: 0.0000005, priceProvenance: 'MARKET_CAP_DERIVED'
  }];

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'eth', address: ADDRESS_A, priceUsd: 2, marketCapUsd: 2_000,
      symbol: 'RIGHT', name: 'Right Token', logoUrl: 'right.png',
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK'
    }]
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(loaded.api.runtime.gmgnQuotes.get(key).priceUsd, 2);
  assert.equal(loaded.calls.metadataBatches.length, 0);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
  assert.equal(loaded.api.runtime.state.positions[key].symbol, 'OLD');
});

test('page TOKEN_QUOTES stay marker-visible but cannot persist on the next real quote tick', async () => {
  const loaded = loadContent({ href: `https://gmgn.ai/eth/token/${ADDRESS_A}` });
  const key = `eth:${ADDRESS_A}`;
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.current.quote = {};
  loaded.api.runtime.state.positions[key] = {
    chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'OLD', name: 'Old', quantity: 1,
    costBasisNative: 1, averageEntryMarketCap: 500, averageEntryPriceUsd: 0.0000005,
    lastPriceUsd: 0.0000005, lastMarketCapUsd: 500,
    lastNativePriceUsd: 2_000, quoteObservedAt: loaded.clock.now - 1,
    totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    valuationMode: 'MARKET_CAP', averageEntryPriceProvenance: 'MARKET_CAP_DERIVED',
    needsCalibration: true, provisional: true, syntheticTokenPrice: true
  };
  loaded.api.runtime.state.trades = [{
    id: 'buy-page-ephemeral', chain: 'eth', tokenAddress: ADDRESS_A, side: 'BUY',
    marketCapUsd: 500, observedPriceUsd: 0.0000005, priceProvenance: 'MARKET_CAP_DERIVED'
  }];
  loaded.api.rememberNativePrice('eth', 2_000, loaded.clock.now);
  let metadataWrites = 0;
  loaded.context.Tango.Store.updatePositionMetadata = async () => {
    metadataWrites += 1;
    return loaded.api.runtime.state;
  };

  loaded.api.dispatchPageMessage({
    source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
      chain: 'eth', address: ADDRESS_A, priceUsd: 2, marketCapUsd: 2_000,
      symbol: 'PAGE', name: 'Page Token', logoUrl: 'page.png',
      observedAt: loaded.clock.now, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
    }]
  });
  assert.equal(loaded.api.runtime.current.quote.priceUsd, 2);
  assert.equal(loaded.api.runtime.persistentGmgnQuotes.has(key), false);
  assert.equal(loaded.api.chartMarkerPayload().markers[0].price, 0.5,
    'page quote remains available to the factual marker renderer');

  await loaded.api.performQuoteTick();

  assert.equal(loaded.calls.updatePositionQuotes.length, 0,
    'a later tick must not launder a page quote into Store');
  assert.equal(metadataWrites, 0,
    'a later tick must not launder page token metadata into Store');
});

test('PnL calendar exposes current-chain trade history and sends the active chain', async () => {
  const loaded = loadContent();
  loaded.api.runtime.calendarOpen = true;
  assert.match(loaded.api.renderPnlCalendar(), /data-action="dashboard-history"/);
  const history = eventElement({ dataset: { action: 'dashboard-history' } });
  loaded.shellLists.set('[data-action]', [history]);
  loaded.api.bindEvents();

  await history.emit('click', { isTrusted: true, stopPropagation() {} });

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
test('GMGN-03 logged-out Solana header renders one paper balance without wallet controls', () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol' });
  const header = loaded.createDomNode();
  header.textContent = 'Register Login';
  loaded.documentSingles.set('header', header);
  loaded.api.runtime.state.accounts.sol.cashBalanceNative = 8;

  loaded.api.renderHeaderAccountSummary({});
  loaded.api.renderHeaderAccountSummary({});

  const summary = loaded.documentSingles.get('#tango-header-account-summary');
  assert.ok(summary, 'logged-out header still exposes the paper account');
  assert.equal(summary.parentElement, header);
  assert.equal(header.children.filter((child) => child.id === summary.id).length, 1);
  assert.match(summary.innerHTML, /8 SOL/);
  summary.onclick({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(loaded.api.runtime.calendarOpen, true);
});

test('GMGN-03 live Connect controls anchor the paper summary beside login before the whole header', () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol' });
  const header = loaded.createDomNode();
  const controls = loaded.createDomNode();
  controls.textContent = 'Register Login';
  loaded.documentSingles.set('header', header);
  loaded.documentSingles.set('[data-sentry-component="Connect"]', controls);

  loaded.api.renderHeaderAccountSummary({});

  assert.equal(loaded.documentSingles.get('#tango-header-account-summary')?.parentElement, controls);
});

test('GMGN-04 invalid buy and sell drafts survive validation and later rerenders until cancel', async () => {
  const loaded = loadContent();
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.presetEditing = 'all';
  setPresetInputs(loaded, { buy: ['0', 2, 3, 4, 5, 6, 7, 8], sell: ['', 10, 15, 20, 25, 50, 75, 100] });

  await loaded.api.savePresetEdits();
  loaded.shadowLists.clear(); // Inputs are temporarily absent after a panel/route rerender.
  loaded.api.render();

  assert.equal(loaded.calls.patches.length, 0);
  assert.equal(loaded.api.runtime.presetEditing, 'all');
  assert.match(loaded.api.renderPanel(), /data-preset-side="buy" data-preset-index="0"[^>]*value="0"/);
  assert.match(loaded.api.renderPanel(), /data-preset-side="sell" data-preset-index="0"[^>]*value=""/);
  const cancel = eventElement({ dataset: { action: 'cancel-presets' } });
  loaded.shellLists.set('[data-action]', [cancel]);
  loaded.api.bindEvents();
  await cancel.emit('click', { isTrusted: true, stopPropagation() {} });
  assert.equal(loaded.api.runtime.presetEditing, null);
  assert.match(loaded.api.renderPanel(), /data-buy="1"/);
  assert.match(loaded.api.renderPanel(), /data-sell="100"/);
});

test('GMGN-04 save failure keeps editable drafts and a corrected retry persists them', async () => {
  let fails = true;
  const loaded = loadContent({ patchSettings: async (patch, settings) => {
    if (fails) throw new Error('storage unavailable');
    return RealState.normalizeSettings({ ...settings, ...patch });
  } });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.presetEditing = 'all';
  setPresetInputs(loaded, { buy: ['0.75', 2, 3, 4, 5, 6, 7, 8] });

  await loaded.api.savePresetEdits();

  assert.equal(loaded.api.runtime.presetEditing, 'all');
  assert.match(loaded.api.renderPanel(), /data-preset-side="buy" data-preset-index="0"[^>]*value="0.75"/);
  fails = false;
  setPresetInputs(loaded, { buy: ['0.8', 2, 3, 4, 5, 6, 7, 8] });
  await loaded.api.savePresetEdits();
  assert.equal(loaded.api.runtime.presetEditing, null);
  assert.equal(loaded.api.runtime.settings.chains.eth.buyPresets[0], 0.8);
});
test('GMGN-04 pending save preserves newer typed buy and sell drafts before any rerender', async () => {
  const write = deferred();
  const loaded = loadContent({ patchSettings: async (patch) => {
    await write.promise;
    return mergeSettingsPatch(loaded.api.runtime.settings, patch);
  } });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.presetEditing = 'all';
  setPresetInputs(loaded, { buy: ['0.75', 2, 3, 4, 5, 6, 7, 8] });
  const saving = loaded.api.savePresetEdits();
  setPresetInputs(loaded, { buy: ['0.85', 2, 3, 4, 5, 6, 7, 8], sell: ['7', 10, 15, 20, 25, 50, 75, 100] });

  write.resolve();
  await saving;

  assert.equal(loaded.api.runtime.settings.chains.eth.buyPresets[0], 0.75);
  assert.equal(loaded.api.runtime.presetEditing, 'all');
  assert.match(loaded.api.renderPanel(), /data-preset-side="buy" data-preset-index="0"[^>]*value="0.85"/);
  assert.match(loaded.api.renderPanel(), /data-preset-side="sell" data-preset-index="0"[^>]*value="7"/);
});

test('GMGN-04 pending save cannot close a new edit session even with identical draft values', async () => {
  const write = deferred();
  const loaded = loadContent({ patchSettings: async (patch) => {
    await write.promise;
    return mergeSettingsPatch(loaded.api.runtime.settings, patch);
  } });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.presetEditing = 'all';
  setPresetInputs(loaded);
  const saving = loaded.api.savePresetEdits();
  const cancel = eventElement({ dataset: { action: 'cancel-presets' } });
  const edit = eventElement({ dataset: { action: 'edit-presets' } });
  loaded.shellLists.set('[data-action]', [cancel, edit]);
  loaded.api.bindEvents();
  const event = { isTrusted: true, stopPropagation() {} };
  await cancel.emit('click', event);
  await edit.emit('click', event);

  write.resolve();
  await saving;

  assert.equal(loaded.api.runtime.presetEditing, 'all');
  assert.match(loaded.api.renderPanel(), /data-preset-side="buy" data-preset-index="0"[^>]*value="1"/);
});

test('GMGN-04 pending previous-chain save preserves the new chain draft', async () => {
  const write = deferred();
  const loaded = loadContent({ patchSettings: async (patch) => {
    await write.promise;
    return mergeSettingsPatch(loaded.api.runtime.settings, patch);
  } });
  loaded.api.runtime.current = quoteContext();
  loaded.api.runtime.presetEditing = 'all';
  setPresetInputs(loaded, { buy: ['0.75', 2, 3, 4, 5, 6, 7, 8] });
  const saving = loaded.api.savePresetEdits();
  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.runtime.current = { ...quoteContext(ADDRESS_B), token: { chain: 'base', address: ADDRESS_B, symbol: 'BASE' } };
  loaded.api.render();
  setPresetInputs(loaded, { buy: ['0.85', 2, 3, 4, 5, 6, 7, 8] });

  write.resolve();
  await saving;

  assert.equal(loaded.api.runtime.settings.chains.eth.buyPresets[0], 0.75);
  assert.equal(loaded.api.runtime.settings.chains.base.buyPresets[0], 1);
  assert.equal(loaded.api.runtime.presetEditing, 'all');
  assert.match(loaded.api.renderPanel(), /data-preset-side="buy" data-preset-index="0"[^>]*value="0.85"/);
});

test('trusted page shortcut works while disabled and rejects synthetic, repeat, and modified keys', async () => {
  const loaded = loadContent();
  loaded.api.runtime.settings.enabled = false;
  const listener = loaded.windowListeners.get('keydown');
  assert.equal(typeof listener, 'function');
  let prevented = 0;
  const base = { isTrusted: true, altKey: true, shiftKey: true, code: 'KeyY', key: 'Y', preventDefault() { prevented += 1; } };
  for (const patch of [{ isTrusted: false }, { repeat: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: false }, { shiftKey: false }, { code: 'KeyQ', key: 'Q' }, { code: 'KeyP', key: 'P' }]) {
    await listener({ ...base, ...patch });
  }
  assert.equal(loaded.messages.filter(m => m.type === 'TANGO_TOGGLE_SHORTCUT').length, 0);
  await listener(base);
  assert.equal(prevented, 1);
  assert.equal(loaded.messages.filter(m => m.type === 'TANGO_TOGGLE_SHORTCUT').length, 1);
});

test('saved floating positions stay visible on render and resize without overwriting user coordinates', () => {
  for (const [selector, setting] of [['.tango-bar', 'barPosition'], ['.tango-panel', 'panelPosition'], ['.tango-drawer', 'drawerPosition']]) {
    const loaded = loadContent();
    loaded.api.runtime.settings[setting] = { x: 990, y: 1000 };
    loaded.context.innerWidth = 800;
    loaded.context.innerHeight = 600;
    const element = { style: {}, addEventListener() {}, getBoundingClientRect: () => ({ width: 300, height: 100 }) };
    loaded.shadowSingles.set(selector, element);
    loaded.api.render();
    assert.equal(element.style.left, '500px', `${selector} after initial render`);
    assert.equal(element.style.top, '500px');
    loaded.context.innerWidth = 1400;
    loaded.context.innerHeight = 1200;
    loaded.windowListeners.get('resize')();
    assert.equal(element.style.left, '990px', 'expanding restores the saved preferred position');
    assert.equal(element.style.top, '1000px');
    loaded.context.innerWidth = 250;
    loaded.context.innerHeight = 80;
    loaded.windowListeners.get('resize')();
    assert.equal(element.style.left, '0px');
    assert.equal(element.style.top, '0px');
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.settings[setting])), { x: 990, y: 1000 });
    assert.equal(loaded.calls.patches.length, 0, 'viewport changes must not persist new positions');
  }
});

test('GMGN trade sounds fall back locally when a remote playback never starts', () => {
  const timers = [];
  const loaded = loadContent({ timer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; } });
  const audio = installTradeAudioHarness(loaded);
  loaded.api.runtime.settings.soundEnabled = true;
  loaded.api.playTradeSound('BUY');
  loaded.api.playTradeSound('SELL');
  assert.equal(audio.remote, 2, 'GMGN cues are preferred');
  assert.deepEqual(audio.starts, [], 'no local cue while remote playback can start');
  assert.deepEqual(timers.map(timer => timer.ms), [800, 800]);
  timers.forEach(timer => timer.callback());
  assert.deepEqual(audio.starts, [660, 880, 520, 390]);
});

test('GMGN buy and sell playback cancels fallback and does not interrupt consecutive fills', async () => {
  const timers = [], urls = [], instances = [];
  const loaded = loadContent({ timer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; } });
  const audio = installTradeAudioHarness(loaded);
  loaded.context.Audio = class {
    constructor(url) { this.url = url; urls.push(url); }
    cloneNode() { const clone = { play: () => Promise.resolve(), pause() { throw new Error('successful audio was interrupted'); } }; instances.push(clone); return clone; }
  };
  loaded.api.runtime.settings.soundEnabled = true;
  loaded.api.playTradeSound('BUY');
  loaded.api.playTradeSound('BUY');
  loaded.api.playTradeSound('SELL');
  await Promise.resolve();
  timers.forEach(timer => timer.callback());
  assert.deepEqual(urls, ['https://gmgn.ai/static/sounds/Handgun.mp3', 'https://gmgn.ai/static/sounds/Kaching.mp3']);
  assert.equal(new Set(instances).size, 3);
  assert.deepEqual(audio.starts, []);
});

test('late GMGN playback is stopped after the local fallback has already sounded', async () => {
  const timers = [], pending = deferred();
  const loaded = loadContent({ timer: callback => { timers.push(callback); return timers.length; } });
  const audio = installTradeAudioHarness(loaded);
  let pauses = 0;
  loaded.context.Audio = class { play() { return pending.promise; } pause() { pauses += 1; } };
  loaded.api.runtime.settings.soundEnabled = true;
  loaded.api.playTradeSound('BUY');
  timers[0]();
  pending.resolve();
  await Promise.resolve();
  assert.equal(pauses, 2);
  assert.deepEqual(audio.starts, [660, 880]);
});

test('disabling sound after a cue was primed prevents cached media playback', () => {
  const loaded = loadContent();
  const audio = installTradeAudioHarness(loaded);
  loaded.api.runtime.settings.soundEnabled = true;
  loaded.api.primeTradeAudio();
  loaded.api.runtime.tradeSounds = { BUY: { play() { audio.remote += 1; return Promise.resolve(); } } };
  loaded.api.runtime.settings.soundEnabled = false;
  loaded.api.playTradeSound('BUY');
  assert.equal(audio.remote, 0);
  assert.deepEqual(audio.starts, []);
});

test('confirmation re-primes a suspended audio context before awaiting the trade', async () => {
  const loaded = loadContent();
  const audio = installTradeAudioHarness(loaded);
  loaded.api.runtime.settings.soundEnabled = true;
  loaded.api.primeTradeAudio();
  loaded.api.runtime.audioContext.state = 'suspended';
  let stateAtCommit;
  loaded.api.runtime.modal = { action: async () => { stateAtCommit = loaded.api.runtime.audioContext.state; } };
  const confirm = eventElement({ dataset: { action: 'confirm-modal' } });
  loaded.shellLists.set('[data-action]', [confirm]);
  loaded.api.bindEvents();
  await confirm.emit('click', { isTrusted: true, stopPropagation() {} });
  assert.equal(stateAtCommit, 'running');
  assert.equal(audio.resumes, 1);
});


test('live chart controls override stale initial widget USD and MCAP metadata', () => {
  const frame = chartFrame({widgetOptions:new URLSearchParams({symbol:`eth/${ADDRESS_A}/USD/MCAP`}).toString()});
  const span=(text,selected)=>({textContent:text,classList:{contains:cls=>cls==='text-text-100'&&selected}});
  let quote='ETH'; let price='Price';
  const scope={querySelectorAll(selector){
    if(selector==='[data-sentry-component="QuoteSelect"]')return [{children:[span('USD',quote==='USD'),span('ETH',quote==='ETH')]}];
    if(selector==='[data-sentry-component="PriceType"]')return [{children:[span('Price',price==='Price'),span('Market Cap',price==='Market Cap')]}];
    return [];
  }};
  frame.closest=selector=>selector==='.chart-anchor-scope'?scope:null;
  const loaded=loadContent({chartFrames:[frame]});
  loaded.api.runtime.nativePrices.set('eth',2000);
  loaded.api.runtime.nativePriceObservedAt.set('eth',loaded.clock.now);
  loaded.api.syncChartMarkers(true);
  assert.equal(chartMarkerMessages(frame).at(-1).context.axisHint,'PRICE');
  assert.equal(chartMarkerMessages(frame).at(-1).context.quoteUsd,2000);
  quote='USD';price='Market Cap';loaded.api.syncChartMarkers();
  assert.equal(chartMarkerMessages(frame).at(-1).context.axisHint,'MARKET_CAP');
  assert.equal(chartMarkerMessages(frame).at(-1).context.quoteUsd,1);
  quote='ETH';loaded.api.runtime.nativePriceObservedAt.set('eth',loaded.clock.now-60000);loaded.api.syncChartMarkers();
  assert.equal(chartMarkerMessages(frame).at(-1).context.quoteUsd,0,'expired native conversion must not guess USD');
});

test('dashboard failures expose an export-only recovery dialog without retrying a trade', async () => {
  const loaded=loadContent({sendMessage:async()=>({ok:false,error:'Cannot create extension tab in this browser'})});
  const button=eventElement({dataset:{action:'dashboard'}});
  loaded.shellLists.set('[data-action]',[button]);loaded.api.bindEvents();
  await button.emit('click',{isTrusted:true,stopPropagation(){}});
  assert.equal(loaded.api.runtime.modal?.type,'dashboard-error');
  const html=loaded.shell.innerHTML;
  assert.match(html,/Cannot create extension tab/);
  assert.match(html,/data-action="export-backup"/);
  assert.doesNotMatch(html,/data-action="confirm-modal"/);
  assert.equal(loaded.calls.buy,0);assert.equal(loaded.calls.sell,0);
});

test('page recovery export downloads the canonical full backup without changing state', async () => {
  const loaded=loadContent({timer:()=>0});
  const data={product:'Tango Paper Trader',version:'0.3.0',settings:defaultSettings(),state:defaultState()};
  loaded.context.Tango.Store.exportData=async()=>data;
  let blob;let clicked=0;let removed=0;
  loaded.context.Blob=Blob;
  loaded.context.URL={createObjectURL(value){blob=value;return 'blob:backup';},revokeObjectURL(){}};
  const anchor={click(){clicked++;},remove(){removed++;}};
  loaded.context.document.createElement=()=>anchor;
  loaded.context.document.body={appendChild(){throw new Error('backup link must stay outside the public DOM');}};
  const button=eventElement({dataset:{action:'export-backup'}});
  loaded.shellLists.set('[data-action]',[button]);loaded.api.bindEvents();
  await button.emit('click',{isTrusted:true,stopPropagation(){}});
  assert.equal(clicked,1);assert.equal(removed,1);
  assert.equal(blob.type,'application/json');
  assert.deepEqual(JSON.parse(await blob.text()),data);
  assert.match(anchor.download,/^tango-backup-.*\.json$/);
  assert.equal(loaded.calls.buy,0);assert.equal(loaded.calls.sell,0);
});

test('native initial widget metadata uses live chart mode and cannot default to USD before controls mount', () => {
  const frame=chartFrame({widgetOptions:new URLSearchParams({symbol:`eth/${ADDRESS_A}/ETH/MCAP`}).toString()});
  const loaded=loadContent({chartFrames:[frame]});
  loaded.api.syncChartMarkers(true);
  assert.equal(chartMarkerMessages(frame).at(-1).context.quoteUsd,0);
  const selected=text=>({textContent:text,classList:{contains:()=>true}});
  frame.closest=()=>({querySelectorAll(selector){return [{children:[selected(selector.includes('PriceType')?'Price':'ETH')]}];}});
  loaded.api.syncChartMarkers(true);
  assert.equal(chartMarkerMessages(frame).at(-1).context.axisHint,'PRICE');
});

test('page backup import only previews until trusted confirmation and serializes a double confirmation', async () => {
  const loaded=loadContent();
  const payload={product:'Tango Paper Trader',version:'0.3.0',state:defaultState(),settings:defaultSettings()};
  let imports=0;const gate=deferred();
  loaded.context.Tango.Store.importData=async value=>{assert.deepEqual(JSON.parse(JSON.stringify(value)),payload);imports++;await gate.promise;return {state:payload.state,settings:payload.settings};};
  loaded.api.runtime.modal={type:'dashboard-error'};
  const file=eventElement();file.files=[{name:'restore.json',text:async()=>JSON.stringify(payload)}];
  loaded.shadowSingles.set('#tango-import-backup',file);
  loaded.api.bindEvents();
  await file.emit('change',{isTrusted:false});
  assert.equal(loaded.api.runtime.modal.type,'dashboard-error');
  await file.emit('change',{isTrusted:true});
  assert.equal(imports,0,'file selection cannot mutate account');
  assert.equal(loaded.api.runtime.modal.type,'confirm');
  const confirm=loaded.api.runtime.modal.action;
  const first=confirm();const second=confirm();
  assert.equal(imports,1);gate.resolve();await Promise.all([first,second]);
  assert.equal(imports,1);
});

test('backup read completing after cancellation does not reopen the import dialog', async () => {
  const loaded=loadContent();const gate=deferred();
  loaded.api.runtime.modal={type:'dashboard-error'};
  const file=eventElement();file.files=[{name:'restore.json',text:()=>gate.promise}];
  loaded.shadowSingles.set('#tango-import-backup',file);loaded.api.bindEvents();
  const reading=file.emit('change',{isTrusted:true});
  loaded.api.runtime.modal=null;
  gate.resolve(JSON.stringify({product:'Tango Paper Trader',state:defaultState(),settings:defaultSettings()}));
  await reading;
  assert.equal(loaded.api.runtime.modal,null);
});

test('backup recovery uses a visible native file input so shell trust checks cannot block file selection', () => {
  const loaded=loadContent();loaded.api.runtime.modal={type:'dashboard-error',title:'Blocked',note:'browser'};
  loaded.api.render();
  assert.match(loaded.shell.innerHTML,/<input id="tango-import-backup"[^>]*type="file"/);
  assert.doesNotMatch(loaded.shell.innerHTML,/<input id="tango-import-backup"[^>]*hidden/);
});

test('market updates retain the file input while the recovery dialog remains open', () => {
  const loaded=loadContent();loaded.api.runtime.modal={type:'dashboard-error',title:'Blocked',note:'browser'};
  loaded.api.render();const before=loaded.shell.innerHTML;
  loaded.shadowSingles.set('#tango-import-backup',eventElement());
  loaded.api.runtime.state.accounts.eth.cashBalanceNative=8;
  loaded.api.render();
  assert.equal(loaded.shell.innerHTML,before,'market rendering must not detach an active native file chooser');
  loaded.api.runtime.modal=null;loaded.api.render();
  assert.notEqual(loaded.shell.innerHTML,before,'closing the dialog releases the render hold');
});

test('invalid recovery file errors remain visible while preserving the open recovery flow', async () => {
  const loaded=loadContent();loaded.api.runtime.modal={type:'dashboard-error',title:'Blocked',note:'browser'};
  loaded.api.render();
  const file=eventElement();file.files=[{name:'bad.json',text:async()=>'{invalid'}];
  loaded.shadowSingles.set('#tango-import-backup',file);loaded.api.bindEvents();
  await file.emit('change',{isTrusted:true});
  assert.equal(loaded.api.runtime.modal.type,'dashboard-error');
  assert.equal(loaded.api.runtime.modal.note,'importFailed');
  assert.match(loaded.shell.innerHTML,/importFailed/);
});

test('recovery export errors are visible without leaving a stale frozen error dialog', async () => {
  const loaded=loadContent();loaded.api.runtime.modal={type:'dashboard-error',title:'Blocked',note:'browser'};
  loaded.api.render();loaded.shadowSingles.set('#tango-import-backup',eventElement());
  loaded.context.Tango.Store.exportData=async()=>{throw new Error('storageFailed');};
  const button=eventElement({dataset:{action:'export-backup'}});
  loaded.shellLists.set('[data-action]',[button]);loaded.api.bindEvents();
  await button.emit('click',{isTrusted:true,stopPropagation(){}});
  assert.equal(loaded.api.runtime.modal.note,'storageFailed');
  assert.match(loaded.shell.innerHTML,/storageFailed/);
});


test('position link contains synchronous runtime failure and reports browser rejection details', async () => {
  for (const mode of ['sync', 'reject', 'response']) {
    const detail = mode === 'sync' ? 'Extension context invalidated.' : 'Owl token tab was blocked before presentation.';
    const loaded = loadContent({ sendMessage() {
      if (mode === 'sync') throw new Error(detail);
      return mode === 'reject' ? Promise.reject(new Error(detail)) : Promise.resolve({ ok: false, error: detail });
    }});
    seedHeldDetailPosition(loaded);
    const button = eventElement({ dataset: { key: `eth:${ADDRESS_A}` } });
    loaded.shellLists.set('[data-position-open]', [button]);
    loaded.api.bindEvents();
    await button.emit('click', { isTrusted: true });
    assert.match(loaded.api.runtime.toast?.message || '', new RegExp(detail.replaceAll('.', '\\.')));
    assert.equal(loaded.api.runtime.toast?.type, 'error');
    assert.equal(loaded.calls.buy, 0);
    assert.equal(loaded.calls.sell, 0);
  }
});


test('position link keeps success quiet and handles absent or unsafe failure details', async () => {
  for (const response of [{ ok: true }, undefined, { ok: false, error: '<img src=x onerror=alert(1)>' + 'x'.repeat(500) }]) {
    const loaded = loadContent({ sendMessage: async () => response });
    seedHeldDetailPosition(loaded);
    const button = eventElement({ dataset: { key: `eth:${ADDRESS_A}` } });
    loaded.shellLists.set('[data-position-open]', [button]);
    loaded.api.bindEvents();
    await button.emit('click', { isTrusted: true });
    if (response?.ok) assert.equal(loaded.api.runtime.toast, null);
    else {
      assert.match(loaded.api.runtime.toast.message, /openTokenFailed/);
      assert.doesNotMatch(loaded.shell.innerHTML, /<img src=x/);
      assert.doesNotMatch(loaded.api.runtime.toast.message, /x{301}/);
      if (response?.error) assert.match(loaded.shell.innerHTML, /&lt;img/);
    }
    assert.equal(loaded.messages.filter((message) => message.type === 'TANGO_OPEN_TOKEN').length, 1);
  }
});


test('position link exposes the exact opening boundary without account data', async () => {
  const gate = deferred();
  const loaded = loadContent({ sendMessage: () => gate.promise });
  seedHeldDetailPosition(loaded);
  const button = eventElement({ dataset: { key: `eth:${ADDRESS_A}` } });
  loaded.shellLists.set('[data-position-open]', [button]);
  loaded.api.bindEvents();
  assert.equal(loaded.host.getAttribute('data-tango-token-open-status'), 'idle');
  const opening = button.emit('click', { isTrusted: true });
  assert.equal(loaded.host.getAttribute('data-tango-token-open-status'), 'requested');
  gate.resolve({ ok: false, error: 'browser refused' });
  await opening;
  assert.equal(loaded.host.getAttribute('data-tango-token-open-status'), 'failed');
  delete loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`];
  await button.emit('click', { isTrusted: true });
  assert.equal(loaded.host.getAttribute('data-tango-token-open-status'), 'missing-position');
  assert.equal(loaded.api.runtime.toast.type, 'error');
  assert.equal(loaded.messages.filter((message) => message.type === 'TANGO_OPEN_TOKEN').length, 1);
});


test('position opening diagnostics contain only known booleans and clear on the next request', async () => {
  let count = 0;
  const loaded = loadContent({ sendMessage: async () => ++count === 1 ? {
    ok: false, error: 'Browser did not return a created token tab',
    opening: { sourceWindowKnown: true, returnedWindowKnown: false, returnedTab: false, hasTabId: false, sameWindow: '<img>', active: null, extra: 'not for DOM' }
  } : { ok: false, error: 'browser refused' } });
  seedHeldDetailPosition(loaded);
  const button = eventElement({ dataset: { key: `eth:${ADDRESS_A}` } });
  loaded.shellLists.set('[data-position-open]', [button]);
  loaded.api.bindEvents();
  await button.emit('click', { isTrusted: true });
  const result = JSON.parse(loaded.host.getAttribute('data-tango-token-open-result'));
  assert.equal(result.sourceWindowKnown, true);
  assert.equal(result.hasTabId, false);
  assert.equal(result.sameWindow, null);
  assert.equal(Object.hasOwn(result, 'extra'), false);
  await button.emit('click', { isTrusted: true });
  assert.equal(loaded.host.getAttribute('data-tango-token-open-result'), '');
});


test('healthy trench quote ticks avoid full button rescans but retain a bounded full fallback', async () => {
  const loaded = loadContent({ href:'https://gmgn.ai/?chain=bsc' });
  loaded.context.Tango.GMGN._isTrenchPage = () => true;
  await loaded.api.performRefresh();
  const initial = loaded.calls.discoverTokenCards;
  for (let i=0;i<5;i++) { loaded.clock.now += 3000; await loaded.api.performQuoteTick(); }
  assert.equal(loaded.calls.discoverTokenCards,initial);
  loaded.clock.now += 30001;
  await loaded.api.performQuoteTick();
  assert.equal(loaded.calls.discoverTokenCards,initial+1);
});

test('style and text-only observer batches do not scan chart frame inventory', async () => {
  const { loaded, observerCallback } = await mutationLaneScenario();
  const original = loaded.context.document.querySelectorAll;
  let chartScans = 0;
  loaded.context.document.querySelectorAll = selector => {
    if (String(selector).includes('iframe')) chartScans++;
    return original(selector);
  };
  observerCallback([{type:'attributes',attributeName:'style',oldValue:'old',target:{getAttribute:()=> 'new'}}]);
  assert.equal(chartScans,0);
});


test('detail totals scan once with a single current-address normalization and preserve exact sums',()=>{
 const loaded=loadContent();const state=defaultState();
 state.trades=Array.from({length:1000},(_,i)=>({chain:i%2?'eth':'base',tokenAddress:i%3?ADDRESS_A:ADDRESS_B,side:i%5?'SELL':'BUY',amountNative:i/1000,realizedPnlNative:(i%7-3)/1000}));
 const expected=state.trades.filter(t=>t.chain==='eth'&&t.tokenAddress===ADDRESS_A);
 const original=Chains.normalizeAddress;let targetReads=0;
 Chains.normalizeAddress=(chain,address)=>{if(address===ADDRESS_A.toUpperCase())targetReads++;return original(chain,address)};
 try{
  const totals=loaded.api.tokenTradeTotals('eth',ADDRESS_A.toUpperCase(),state.trades);
  assert.equal(totals.totalBuy,expected.filter(t=>t.side==='BUY').reduce((n,t)=>n+t.amountNative,0));
  assert.equal(totals.totalSell,expected.filter(t=>t.side==='SELL').reduce((n,t)=>n+t.amountNative,0));
  assert.equal(totals.realizedPnl,expected.filter(t=>t.side==='SELL').reduce((n,t)=>n+t.realizedPnlNative,0));
  assert.equal(targetReads,1);
 }finally{Chains.normalizeAddress=original;}
});

test('floating elements batch geometry reads before style writes and skip equal styles',()=>{
 const loaded=loadContent();const events=[];
 for(const [selector,key] of [['.tango-bar','barPosition'],['.tango-panel','panelPosition'],['.tango-drawer','drawerPosition']]){
  loaded.api.runtime.settings[key]={x:10,y:20};const data={};
  loaded.shadowSingles.set(selector,{style:new Proxy(data,{set(target,key,value){events.push('write');target[key]=value;return true;}}),getBoundingClientRect(){events.push('read');return{width:100,height:50};}});
 }
 loaded.api.constrainFloatingElements();assert.deepEqual(events.slice(0,3),['read','read','read']);
 events.length=0;loaded.api.constrainFloatingElements();assert.deepEqual(events,['read','read','read']);
});

test('unrelated child-list mutations do not enumerate chart frames',async()=>{
 const {loaded,observerCallback}=await mutationLaneScenario();let scans=0;const query=loaded.context.document.querySelectorAll;
 loaded.context.document.querySelectorAll=selector=>{if(String(selector).includes('iframe'))scans++;return query(selector)};
 observerCallback([{type:'childList',target:{nodeType:1,tagName:'DIV'},addedNodes:[{nodeType:3,textContent:'price'}],removedNodes:[]}]);
 assert.equal(scans,0);
});

test('hidden pages pause marker display only and synchronize immediately on visibility return',async()=>{
 const loaded=loadContent();const intervals=new Map(),events=new Map();let builds=0;
 loaded.context.setInterval=(callback,delay)=>{intervals.set(delay,callback);return delay};
 loaded.context.document.addEventListener=(type,callback)=>events.set(type,callback);
 loaded.context.Tango.Markers={buildPayload(){builds++;return{markers:[]}}};await loaded.api.start();
 loaded.context.document.hidden=true;const before=builds;intervals.get(1000)();assert.equal(builds,before);
 assert.ok(intervals.has(750)&&intervals.has(150)&&intervals.has(3000));
 loaded.context.document.hidden=false;events.get('visibilitychange')();assert.equal(builds,before+1);
});

test('fresh GMGN page dimensions outrank a slightly newer DEX fallback while native loading uses position history',()=>{
 const loaded=loadContent({href:`https://gmgn.ai/bsc/token/${ADDRESS_A}`});const now=loaded.clock.now;
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/adapters/gmgn-quotes.js'),'utf8'),loaded.context);
 const token={chain:'bsc',address:ADDRESS_A,symbol:'LIVE',metadataVerified:true,metadataSource:'GMGN_DETAIL'};
 const page={chain:'bsc',address:ADDRESS_A,source:'GMGN',priceUsd:0.0000233,marketCapUsd:23300,totalSupply:1e9,supplySource:'GMGN_EXACT',observedAt:now-200,priceObservedAt:now-200,priceSource:'GMGN',marketCapObservedAt:now-200,marketCapSource:'GMGN',totalSupplyObservedAt:now-200,totalSupplyObservationSource:'GMGN',priceProvenance:'OBSERVED_PRICE'};
 const dex={chain:'bsc',address:ADDRESS_A,source:'DEXSCREENER',priceUsd:0.0000032,marketCapUsd:3200,observedAt:now-100,priceObservedAt:now-100,priceSource:'DEXSCREENER',marketCapObservedAt:now-100,marketCapSource:'DEXSCREENER',priceProvenance:'OBSERVED_PRICE'};
 const position={chain:'bsc',tokenAddress:ADDRESS_A,quantity:3e7,costBasisNative:1,lastPriceUsd:page.priceUsd,lastMarketCapUsd:23300,lastNativePriceUsd:700,totalSupply:1e9,supplySource:'GMGN_EXACT',quoteSource:'GMGN',quoteObservedAt:now-300,syntheticTokenPrice:false,provisionalTokenPrice:false,valuationMode:'PRICE'};
 loaded.api.runtime.state.positions[`bsc:${ADDRESS_A}`]=position;loaded.api.runtime.gmgnQuotes.set(`bsc:${ADDRESS_A}`,dex);
 const before=JSON.stringify([page,dex,position]);const quote=loaded.api.resolvePaperTradeQuote(token,page,{position});
 assert.equal(quote.priceUsd,page.priceUsd);assert.equal(quote.marketCapUsd,page.marketCapUsd);assert.equal(quote.priceObservedAt,page.priceObservedAt);
 assert.equal(JSON.stringify([page,dex,position]),before);
 loaded.api.runtime.gmgnQuotes.set(`bsc:${ADDRESS_A}`,page);
 const reverse=loaded.api.resolvePaperTradeQuote(token,dex,{position});
 assert.equal(reverse.priceUsd,page.priceUsd,'cached GMGN also wins over a later DEX candidate');
 loaded.api.runtime.gmgnQuotes.set(`bsc:${ADDRESS_A}`,dex);
 const stale={...page,observedAt:now-16000,priceObservedAt:now-16000,marketCapObservedAt:now-16000};
 assert.equal(loaded.api.resolvePaperTradeQuote(token,stale,{position}).priceUsd,dex.priceUsd,'DEX remains available when GMGN is stale');
 loaded.api.runtime.gmgnQuotes.set(`bsc:${ADDRESS_A}`,{...dex,source:'GMGN_NETWORK',priceSource:'GMGN_NETWORK',marketCapSource:'GMGN_NETWORK'});
 assert.equal(loaded.api.resolvePaperTradeQuote(token,page,{position}).priceUsd,dex.priceUsd,'newer GMGN observations preserve timestamp ordering');
});

test('breakeven action follows the current market cap in its own aligned display block',()=>{
 const loaded=loadContent({href:`https://gmgn.ai/base/token/${ADDRESS_A}`});
 loaded.api.runtime.current={token:{chain:'base',address:ADDRESS_A,symbol:'TEST'},quote:{marketCapUsd:10000}};
 const html=loaded.api.renderPanel();assert.ok(html);
 assert.match(html,/<div class="tango-sell-market-actions"><span class="safe">[^<]*<\/span><button class="tango-breakeven-link" data-action="breakeven"/);
 const css=fs.readFileSync(path.resolve(__dirname,'../src/content/content.css'),'utf8');
 assert.match(css,/\.tango-sell-market-actions\s*\{[^}]*flex-direction:\s*column/);
 assert.match(css,/\.tango-breakeven-link\s*\{[^}]*font-size:\s*13px/);
});

test('detail recover-cost confirmation preserves the intent and shows already-recovered status',async()=>{
 const loaded=loadContent();loaded.api.runtime.current=quoteContext();
 const position={chain:'eth',tokenAddress:ADDRESS_A,symbol:'TEST',quantity:2000,costBasisNative:1,realizedPnlNative:.2,lastPriceUsd:2,lastNativePriceUsd:3000,quoteObservedAt:loaded.clock.now};
 loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`]=position;loaded.api.rememberNativePrice('eth',3000,loaded.clock.now);
 loaded.context.Tango.Engine.breakevenSellPercent=()=>40.123456789;
 loaded.context.Tango.Engine.breakevenTargetNative=RealEngine.breakevenTargetNative;
 await loaded.api.sellBreakeven();assert.equal(loaded.api.runtime.modal.type,'confirm');
 assert.match(loaded.api.runtime.modal.note,/breakevenRecalculated/);
 await loaded.api.runtime.modal.action();assert.equal(loaded.calls.sellOrders[0].breakeven,true);
 position.realizedPnlNative=1;assert.match(loaded.api.renderPanel(),/breakevenRecovered/);
});

 test('background DEX refresh cannot replace a fresh verified GMGN detail quote', async () => {
 let loaded; loaded=loadContent({sendMessage:message=>message.type==='TANGO_GET_TOKEN_QUOTE'?Promise.resolve({quote:{chain:'eth',address:ADDRESS_A,priceUsd:.00000345,marketCapUsd:3365.07,source:'DEXSCREENER',priceProvenance:'OBSERVED_PRICE',observedAt:loaded.clock.now}}):Promise.resolve({ok:true})});
 loaded.clock.now=Date.now();
 const context={token:{chain:'eth',address:ADDRESS_A,symbol:'COSMO'},quote:{priceUsd:.0000523,marketCapUsd:50990,totalSupply:973500000,supplySource:'GMGN_EXACT',source:'GMGN',priceProvenance:'OBSERVED_PRICE',observedAt:loaded.clock.now}};
 loaded.api.runtime.current=context;loaded.api.ensureTokenQuote(context);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(context.quote.priceUsd,.0000523);assert.equal(context.quote.marketCapUsd,50990);
});

 test('cached DEX observation cannot replace a fresh GMGN header, but refreshes it after expiry', () => {
 const loaded=loadContent();loaded.clock.now=Date.now();const now=loaded.clock.now;
 const context={token:{chain:'eth',address:ADDRESS_A},quote:{priceUsd:.0000523,marketCapUsd:50990,source:'GMGN',priceProvenance:'OBSERVED_PRICE',observedAt:now}};loaded.api.runtime.current=context;
 loaded.api.runtime.persistentGmgnQuotes.set('eth:'+ADDRESS_A,{chain:'eth',address:ADDRESS_A,priceUsd:.00000345,marketCapUsd:3365.07,source:'DEXSCREENER',priceProvenance:'OBSERVED_PRICE',observedAt:now});
 loaded.api.ensureTokenQuote(context);assert.equal(context.quote.priceUsd,.0000523);
 context.quote.priceObservedAt=now-loaded.context.Tango.QUOTE_STALE_MS-1;
 loaded.api.ensureTokenQuote(context);assert.equal(context.quote.priceUsd,.00000345);
});

test('page calendar opens a day report without modifying accounts or placing orders',async()=>{const loaded=loadContent();const before=JSON.stringify(loaded.api.runtime.state);loaded.api.openDailyReport('2026-10-15');assert.equal(loaded.api.runtime.modal.type,'daily-report');assert.equal(loaded.api.runtime.modal.report.chain,'eth');assert.match(loaded.api.renderModal(),/data-report-action="download"/);await loaded.api.reportAction('usd');assert.equal(loaded.api.runtime.modal.currency,'USD');assert.equal(JSON.stringify(loaded.api.runtime.state),before);assert.equal(loaded.calls.buy+loaded.calls.sell,0);await loaded.api.reportAction('history');assert.doesNotMatch(loaded.shell.innerHTML,/tango-report-overlay/);assert.equal(loaded.messages.at(-1).date,'2026-10-15');assert.equal(loaded.messages.at(-1).chain,'eth');});

test('page backup export keeps a readable canonical fallback when browser silently ignores download',async()=>{
 const loaded=loadContent({timer:()=>0}),data={product:'Tango Paper Trader',state:defaultState(),settings:defaultSettings()};
 loaded.context.Tango.Store.exportData=async()=>data;loaded.context.Blob=Blob;loaded.context.URL={createObjectURL:()=> 'blob:backup',revokeObjectURL(){}};
 loaded.context.document.createElement=()=>({click(){},remove(){}});loaded.context.document.body={appendChild(){}};
 loaded.api.runtime.modal={type:'dashboard-error',title:'blocked',note:'Owl blocked'};
 const button=eventElement({dataset:{action:'export-backup'}});loaded.shellLists.set('[data-action]',[button]);loaded.api.bindEvents();await button.emit('click',{isTrusted:true,stopPropagation(){}});
 assert.equal(loaded.api.runtime.modal.backupJson,JSON.stringify(data,null,2));assert.match(loaded.shell.innerHTML,/tango-backup-json-fallback/);assert.match(loaded.shell.innerHTML,/readonly/);assert.equal(loaded.calls.buy,0);assert.equal(loaded.calls.sell,0);
});

test('Chunkee mixed price and exact-supply market cap cannot produce an executable paper quote',()=>{
 const loaded=loadContent({href:`https://gmgn.ai/sol/token/AE2WNvKXrpBugJEJ57ETSeT8mMdtC1XBtnkU77Aypump`}),now=loaded.clock.now;
 const token={chain:'sol',address:'AE2WNvKXrpBugJEJ57ETSeT8mMdtC1XBtnkU77Aypump',symbol:'Chunkee'};
 const observed={chain:'sol',address:token.address,priceUsd:.000003162598,marketCapUsd:30162.11,totalSupply:1e9,totalSupplySource:'GMGN_EXACT',totalSupplyObservationSource:'GMGN_DETAIL',source:'GMGN_NETWORK',priceSource:'GMGN_NETWORK',marketCapSource:'GMGN_DETAIL',observedAt:now,priceObservedAt:now-1000,marketCapObservedAt:now,totalSupplyObservedAt:now,nativePriceUsd:104,nativePriceObservedAt:now};
 assert.equal(loaded.api.resolvePaperTradeQuote(token,observed),null);
 const corrected=loaded.api.resolvePaperTradeQuote(token,{...observed,priceUsd:.00003016211});assert.ok(corrected);assert.equal(corrected.priceUsd,.00003016211);assert.equal(loaded.calls.buy,0);assert.equal(loaded.calls.sell,0);
});


test('settled quick buys accept distinct clicks within one second', async () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=eth' });
  loaded.api.runtime.settings.confirmationEnabled = false;
  const click = { ...quoteContext(), actionId: 'same-slot', amountNative: .1 };
  await loaded.api.handleQuickBuy(click);
  await loaded.api.handleQuickBuy(click);
  assert.equal(loaded.calls.buy, 2);
  assert.equal(loaded.api.runtime.quickBuyLocks.size, 0);
});

test('a contradictory verified detail quote cannot silently execute the old preview', async () => {
  let loaded;
  loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => ({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
    quote: { ...detailQuote(4300, loaded.clock.now), priceUsd: .000043,
      totalSupply: 1_000_000_000, supplySource: 'GMGN_EXACT' }
  }) });
  seedHeldDetailPosition(loaded);
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`].totalSupply = 1_000_000_000;
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`].supplySource = 'GMGN_EXACT';
  await loaded.api.sell(100);
  assert.equal(loaded.calls.sell, 0);
  assert.equal(loaded.api.runtime.toast.type, 'error');
});

test('a detail commit without verified DOM uses the latest same-token quote rather than a frozen preview', async () => {
  const loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => null });
  seedHeldDetailPosition(loaded);
  loaded.api.runtime.settings.confirmationEnabled = true;
  await loaded.api.sell(100);
  loaded.clock.now += 100;
  loaded.api.runtime.gmgnQuotes.set(`eth:${ADDRESS_A}`, detailQuote(2400, loaded.clock.now));
  await loaded.api.runtime.modal.action();
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 2400);
});

test('entering a different held token persists its current quote without the previous token throttle', async () => {
  let loaded;
  loaded = loadContent({ readCurrentToken: async () => null });
  seedHeldDetailPosition(loaded);
  loaded.api.runtime.lastQuoteWriteAt = loaded.clock.now;
  loaded.api.runtime.lastQuoteWriteKey = `eth:${ADDRESS_B}`;
  loaded.api.runtime.persistentGmgnQuotes.set(`eth:${ADDRESS_A}`, detailQuote(4300, loaded.clock.now));
  await loaded.api.performQuoteTick();
  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
  assert.equal(loaded.calls.updatePositionQuotes[0].quote.marketCapUsd, 4300);
});


test('an in-flight quick buy is deduplicated and its lock is released after settlement', async () => {
  const gate = deferred();
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=eth' });
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.context.Tango.Store.executeBuy = async order => {
    loaded.calls.buy += 1;
    await gate.promise;
    return { state: loaded.api.runtime.state, trade: {} };
  };
  const click = { ...quoteContext(), actionId: 'pending-slot', amountNative: .1 };
  const first = loaded.api.handleQuickBuy(click);
  await loaded.api.handleQuickBuy(click);
  assert.equal(loaded.calls.buy, 1);
  gate.resolve();
  await first;
  await loaded.api.handleQuickBuy(click);
  assert.equal(loaded.calls.buy, 2);
});

test('a rejected quick-buy amount does not swallow the corrected next click', async () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=eth' });
  loaded.api.runtime.settings.confirmationEnabled = false;
  const click = { ...quoteContext(), actionId: 'retry-slot', amountNative: 0 };
  await loaded.api.handleQuickBuy(click);
  await loaded.api.handleQuickBuy({ ...click, amountNative: .1 });
  assert.equal(loaded.calls.buy, 1);
  assert.equal(loaded.api.runtime.quickBuyLocks.size, 0);
});


test('returning from the trench resets a held token mark throttle even for the same token', async () => {
  const loaded = loadContent();
  seedHeldDetailPosition(loaded);
  loaded.api.runtime.lastQuoteWriteAt = loaded.clock.now;
  loaded.api.runtime.lastQuoteWriteKey = `eth:${ADDRESS_A}`;
  loaded.context.location.href = 'https://gmgn.ai/?chain=eth';
  loaded.api.handleRouteChange();
  assert.equal(loaded.api.runtime.lastQuoteWriteKey, null);
});


test('a delayed mark write cannot stamp another route or dereference a cleared current token', async () => {
  const gate = deferred();
  const loaded = loadContent({ updatePositionQuote: () => gate.promise });
  seedHeldDetailPosition(loaded);
  loaded.api.rememberNativePrice('eth', 3000, loaded.clock.now);
  const quote = { ...detailQuote(4300, loaded.clock.now), totalSupply: 1_000_000_000,
    supplySource: 'GMGN_EXACT', totalSupplySource: 'GMGN_EXACT' };
  const position = loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`];
  Object.assign(position, { totalSupply: 1_000_000_000, supplySource: 'GMGN_EXACT' });
  loaded.api.runtime.persistentGmgnQuotes.set(`eth:${ADDRESS_A}`, quote);
  const originalState = loaded.api.runtime.state;
  const tick = loaded.api.performQuoteTick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded.calls.updatePositionQuotes.length, 1);
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  loaded.api.runtime.current = null;
  gate.resolve({ ...originalState, oldRouteResponse: true });
  await tick;
  assert.equal(loaded.api.runtime.state, originalState);
  assert.notEqual(loaded.api.runtime.lastQuoteWriteKey, `eth:${ADDRESS_B}`);
});


test('detail sell preview refreshes verified DOM before rejecting a conflicting cached quote', async () => {
  let loaded;
  loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => ({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
    quote: { ...detailQuote(4300, loaded.clock.now), totalSupply: 1e9, supplySource: 'GMGN_EXACT' }
  }) });
  seedHeldDetailPosition(loaded);
  const position = loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`];
  Object.assign(position, { totalSupply: 1e9, supplySource: 'GMGN_EXACT' });
  loaded.api.runtime.current.quote = { ...detailQuote(4300, loaded.clock.now), priceUsd: .000043 };
  loaded.api.runtime.gmgnQuotes.clear();
  await loaded.api.sell(100);
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, .0000043);
});

test('an immediate detail sell reads the matching header before previewing the entry placeholder', async () => {
  let loaded;
  loaded = loadContent({ readCurrentToken: async () => ({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST', metadataSource: 'GMGN_DETAIL', metadataVerified: true },
    quote: detailQuote(4300, loaded.clock.now)
  }) });
  seedHeldDetailPosition(loaded, 3750);
  loaded.api.runtime.current.token.metadataSource = 'GMGN_TRENCH';
  await loaded.api.sell(100);
  assert.equal(loaded.calls.readCurrentToken, 1);
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd, 4300);
});


test('an entry header read completing after navigation cannot sell or restore the previous token', async () => {
  const gate = deferred();
  const loaded = loadContent({ readCurrentToken: () => gate.promise });
  seedHeldDetailPosition(loaded);
  loaded.api.runtime.current.token.metadataSource = 'GMGN_TRENCH';
  const action = loaded.api.sell(100);
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  loaded.api.runtime.current = null;
  gate.resolve(quoteContext());
  await action;
  assert.equal(loaded.calls.sell, 0);
  assert.equal(loaded.api.runtime.current, null);
});


test('a late detail header mutation retries its trench placeholder before the three-second timer', async () => {
  let observer;
  const timers = [];
  const loaded = loadContent({ MutationObserver: class {
    constructor(callback) { observer = callback; } observe() {}
  }, timer(callback) { timers.push(callback); return timers.length; } });
  await loaded.api.start();
  loaded.context.Tango.GMGN.needsCurrentTokenRead = () => true;
  const before = loaded.calls.readCurrentToken;
  const timerIndex = timers.length;
  const header = { nodeType: 1, tagName: 'DIV',
    matches: selector => selector.includes('TokenHeader'), querySelector: () => null, closest: () => null };
  observer([{ type: 'childList', target: { nodeType: 1, tagName: 'DIV' },
    addedNodes: [header], removedNodes: [] }]);
  assert.ok(timers.length > timerIndex, 'late detail header must schedule the mutation lane');
  timers[timerIndex]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded.calls.readCurrentToken, before + 1);
});

test('breakeven preview also refreshes verified DOM before rejecting conflicting entry quotes', async () => {
  let loaded;
  loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => ({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' },
    quote: { ...detailQuote(6000000, loaded.clock.now), totalSupply: 1e9, supplySource: 'GMGN_EXACT' }
  }) });
  loaded.context.Tango.Engine.breakevenSellPercent = (position, quote, settings) => RealEngine.breakevenSellPercent(position, quote, settings, loaded.clock.now);
  loaded.context.Tango.Engine.breakevenTargetNative = RealEngine.breakevenTargetNative;
  seedHeldDetailPosition(loaded);
  const position = loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`];
  Object.assign(position, { totalSupply: 1e9, supplySource: 'GMGN_EXACT' });
  loaded.api.runtime.current.quote = { ...detailQuote(4300, loaded.clock.now), priceUsd: .000043 };
  loaded.api.runtime.gmgnQuotes.clear();
  await loaded.api.sellBreakeven();
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, .006);
});


test('detail startup mutations retry metadata while verified headers use the lightweight quote lane', async () => {
  for (const kind of ['characterData', 'attributes', 'verified']) {
    let observer;
    const timers = [];
    const loaded = loadContent({ MutationObserver: class { constructor(cb) { observer = cb; } observe() {} },
      timer(cb) { timers.push(cb); return timers.length; } });
    await loaded.api.start();
    loaded.context.Tango.GMGN.needsCurrentTokenRead = () => kind !== 'verified';
    const before = loaded.calls.readCurrentToken;
    const timerIndex = timers.length;
    const header = { nodeType: 1, tagName: 'DIV', matches: () => false,
      querySelector: () => null, closest: selector => selector.includes('TokenHeader') ? header : null,
      getAttribute: () => 'new-address' };
    observer([{ type: kind === 'attributes' ? 'attributes' : 'characterData',
      attributeName: 'data-addr', oldValue: 'old-address',
      target: kind === 'attributes' ? header : { nodeType: 3, parentElement: header },
      addedNodes: [], removedNodes: [] }]);
    if (kind === 'verified') {
      assert.ok(timers.length > timerIndex);
      timers[timerIndex]();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(loaded.calls.readCurrentToken, before);
    } else {
      assert.ok(timers.length > timerIndex, kind);
      timers[timerIndex]();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(loaded.calls.readCurrentToken, before + 1, kind);
    }
  }
});

test('detail startup with no chart quote preserves the held mark instead of inventing fallback profit', () => {
  const loaded = loadContent();
  seedHeldDetailPosition(loaded);
  const position = loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`];
  Object.assign(position, { quantity: 1000, costBasisNative: .1, lastPriceUsd: .01,
    averageEntryPriceUsd: .01, lastMarketCapUsd: 10000, lastNativePriceUsd: 100,
    syntheticTokenPrice: true, provisionalTokenPrice: true });
  loaded.api.runtime.current.quote = { priceUsd: 0, marketCapUsd: 0, source: 'GMGN_DETAIL', observedAt: loaded.clock.now };
  loaded.api.runtime.gmgnQuotes.clear();
  loaded.api.runtime.state.positions[`eth:${ADDRESS_B}`] = {
    chain: 'eth', tokenAddress: ADDRESS_B, lastNativePriceUsd: 110, quoteObservedAt: loaded.clock.now + 1
  };
  const before = JSON.stringify(position);
  const html = loaded.api.renderPanel();
  assert.match(html, /totalProfit<\/span><strong[^>]*>0 ETH<\/strong>/);
  assert.match(html, /currentMc[^<]*<strong>\$10000<\/strong>/);
  assert.equal(JSON.stringify(position), before);
  assert.equal(loaded.calls.updatePositionQuotes.length, 0);
});

test('verified detail header updates mark immediately without chart or full quote tick', () => {
  let loaded;
  let snapshot;
  loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => snapshot });
  seedHeldDetailPosition(loaded);
  loaded.api.rememberNativePrice('eth', 3000, loaded.clock.now);
  snapshot = { token: { ...loaded.api.runtime.current.token, metadataSource: 'GMGN_DETAIL', metadataVerified: true },
    quote: detailQuote(4500, loaded.clock.now) };
  assert.equal(loaded.api.refreshDetailDisplayQuote(), true);
  assert.equal(loaded.api.runtime.current.quote.marketCapUsd, 4500);
  assert.match(loaded.api.renderPanel(), /currentMc[^<]*<strong>\$4500<\/strong>/);
  assert.match(loaded.api.renderPanel(), /totalProfit<\/span><strong[^>]*>-0.9985 ETH<\/strong>/);
  assert.equal(loaded.calls.readCurrentToken, 0);
  snapshot = null;
  assert.equal(loaded.api.refreshDetailDisplayQuote(), false);
  assert.equal(loaded.api.runtime.current.quote.marketCapUsd, 4500);
  snapshot = { token: { chain: 'eth', address: ADDRESS_B }, quote: detailQuote(9000, loaded.clock.now) };
  assert.equal(loaded.api.refreshDetailDisplayQuote(), false);
  assert.equal(loaded.api.runtime.current.quote.marketCapUsd, 4500);
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`].totalSupply = 1e9;
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`].supplySource = 'GMGN_EXACT';
  snapshot = { token: { ...loaded.api.runtime.current.token }, quote: { ...detailQuote(4500, loaded.clock.now), priceUsd: .000045, totalSupply: 1e9, supplySource: 'GMGN_EXACT' } };
  assert.equal(loaded.api.refreshDetailDisplayQuote(), false);
  assert.equal(loaded.api.runtime.current.quote.marketCapUsd, 4500);
});


test('live header mutations coalesce and replacement reacquires verified metadata before the slow probe', async () => {
  let observer;
  const timers = [];
  let loaded;
  let snapshot;
  loaded = loadContent({ MutationObserver: class { constructor(cb) { observer = cb; } observe() {} },
    timer(cb) { timers.push(cb); return timers.length; },
    readVerifiedCurrentTokenSnapshot: () => snapshot,
    readCurrentToken: async () => snapshot });
  await loaded.api.start();
  seedHeldDetailPosition(loaded);
  loaded.api.rememberNativePrice('eth', 3000, loaded.clock.now);
  loaded.context.Tango.GMGN.needsCurrentTokenRead = () => false;
  snapshot = { token: { ...loaded.api.runtime.current.token, metadataVerified: true, metadataSource: 'GMGN_DETAIL' }, quote: detailQuote(4500, loaded.clock.now) };
  const header = { nodeType: 1, tagName: 'DIV', matches: selector => selector.includes('BaseInfoBar'), closest: () => null, querySelector: () => null };
  const before = loaded.calls.readCurrentToken;
  const first = timers.length;
  for (let i = 0; i < 3; i++) observer([{ type: 'characterData', target: { nodeType: 3, parentElement: header }, addedNodes: [], removedNodes: [] }]);
  assert.equal(timers.length, first + 1);
  timers[first]();
  assert.equal(loaded.api.runtime.current.quote.marketCapUsd, 4500);
  assert.equal(loaded.calls.readCurrentToken, before);
  snapshot = { ...snapshot, quote: detailQuote(5500, loaded.clock.now) };
  const second = timers.length;
  observer([{ type: 'childList', target: { nodeType: 1, matches: () => false, closest: () => null }, addedNodes: [header], removedNodes: [] }]);
  timers[second]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded.calls.readCurrentToken, before + 1);
  assert.equal(loaded.api.runtime.current.quote.marketCapUsd, 5500);
  const third = timers.length;
  snapshot = { ...snapshot, quote: detailQuote(6500, loaded.clock.now) };
  observer([{ type: 'childList', target: header, addedNodes: [header], removedNodes: [] }]);
  timers[third]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded.calls.readCurrentToken, before + 2, 'nested header replacement also reacquires metadata');
  assert.equal(loaded.api.runtime.current.quote.marketCapUsd, 6500);
});

test('missing chart keeps factual held marks and displays unknown market cap honestly for an unheld token', () => {
  const loaded = loadContent();
  seedHeldDetailPosition(loaded);
  loaded.api.runtime.current.quote = {};
  loaded.api.runtime.gmgnQuotes.clear();
  assert.match(loaded.api.renderPanel(), /currentMc[^<]*<strong>\$3750<\/strong>/);
  delete loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`];
  assert.match(loaded.api.renderPanel(), /currentMc[^<]*<strong>--<\/strong>/);
  assert.equal(loaded.calls.sell, 0);
});

test('network replay cannot replace a verified live header quote with a delayed pool price', () => {
  let loaded;
  loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => ({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST', metadataVerified: true, metadataSource: 'GMGN_DETAIL' },
    quote: { ...detailQuote(28350, loaded.clock.now), totalSupply: 1e9, supplySource: 'GMGN_EXACT' }
  }) });
  seedHeldDetailPosition(loaded, 28350);
  loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
    chain: 'eth', address: ADDRESS_A, priceUsd: .000026806341, marketCapUsd: 28300,
    observedAt: loaded.clock.now + 1, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
  }] });
  assert.equal(loaded.api.runtime.current.quote.priceUsd, .00002835);
  assert.equal(loaded.api.runtime.gmgnQuotes.get(`eth:${ADDRESS_A}`).marketCapUsd, 28350);
});

test('verified launchpad supply rejects a contradictory factual price and cap pair', () => {
  const address = '12kQB4WCZj1Kr61maq4M1APGSa4ynrjTmYUWWPhppump';
  const loaded = loadContent({ href: `https://gmgn.ai/sol/token/${address}` });
  const token = { chain: 'sol', address, launchpad: 'pump.fun', metadataVerified: true, metadataSource: 'GMGN_NETWORK' };
  const candidate = { chain: 'sol', address, priceUsd: .000026806341, marketCapUsd: 28300,
    observedAt: loaded.clock.now, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE' };
  assert.equal(loaded.api.resolvePaperTradeQuote(token, candidate), null);
});

test('header replacement keeps the last fresh DOM quote until the next identity read', () => {
  const loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => null });
  seedHeldDetailPosition(loaded, 28350);
  loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
    chain: 'eth', address: ADDRESS_A, priceUsd: .000026806341, marketCapUsd: 28300,
    observedAt: loaded.clock.now + 1, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
  }] });
  assert.equal(loaded.api.runtime.current.quote.priceUsd, .00002835);
  loaded.clock.now += 16000;
  loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
    chain: 'eth', address: ADDRESS_A, priceUsd: .000028, marketCapUsd: 28000,
    observedAt: loaded.clock.now, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
  }] });
  assert.equal(loaded.api.runtime.current.quote.priceUsd, .000028, 'a stale header must not prevent network fallback');
});

test('header replacement protection also binds an adapter DOM quote without duplicated identity fields', () => {
  const loaded = loadContent({ readVerifiedCurrentTokenSnapshot: () => null });
  seedHeldDetailPosition(loaded, 28350);
  delete loaded.api.runtime.current.quote.chain;
  delete loaded.api.runtime.current.quote.address;
  loaded.api.dispatchPageMessage({ source: 'TANGO_GMGN_PAGE', type: 'TOKEN_QUOTES', quotes: [{
    chain: 'eth', address: ADDRESS_A, priceUsd: .000026806341, marketCapUsd: 28300,
    observedAt: loaded.clock.now + 1, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
  }] });
  assert.equal(loaded.api.runtime.current.quote.priceUsd, .00002835);
});

test('fresh trench market cap does not mix with an older network token price during quick buys', async () => {
  const address = '12kQB4WCZj1Kr61maq4M1APGSa4ynrjTmYUWWPhppump';
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol' });
  const token = { chain: 'sol', address, symbol: 'CAKE', launchpad: 'pump.fun', metadataVerified: true, metadataSource: 'GMGN_TRENCH' };
  loaded.api.runtime.gmgnQuotes.set(`sol:${address}`, { chain: 'sol', address,
    priceUsd: .000026806341, marketCapUsd: 26806.341, observedAt: loaded.clock.now - 100,
    source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE' });
  const candidate = { priceUsd: .0000283, marketCapUsd: 28300, totalSupply: 1e9,
    supplySource: 'LAUNCHPAD_RULE', priceProvenance: 'MARKET_CAP_DERIVED',
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1e9, source: 'GMGN_TRENCH', observedAt: loaded.clock.now };
  const resolved = loaded.api.resolvePaperTradeQuote(token, candidate);
  assert.ok(resolved, 'a fresh card with verified launchpad cap remains executable');
  assert.equal(resolved.priceUsd, .0000283);
  assert.equal(resolved.marketCapUsd, 28300);
  const held = loaded.api.resolvePaperTradeQuote(token, candidate, { position: {
    chain: 'sol', tokenAddress: address, quantity: 100, costBasisNative: .1,
    lastPriceUsd: .000026806341, lastMarketCapUsd: 26806.341,
    totalSupply: 1e9, supplySource: 'GMGN_EXACT'
  }});
  assert.ok(held, 'a previously calibrated holding must not reject the live card');
  assert.equal(held.priceUsd, .0000283);
});


test('trench holding value follows the card without mutating trades or the held quantity', () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=eth' });
  const token = { chain: 'eth', address: ADDRESS_A, symbol: 'TEST' };
  const position = { chain: 'eth', tokenAddress: ADDRESS_A, quantity: 1000,
    costBasisNative: .1, lastPriceUsd: .01, lastNativePriceUsd: 100,
    averageEntryPriceUsd: .01, lastMarketCapUsd: 1e7 };
  loaded.api.runtime.state.positions[`eth:${ADDRESS_A}`] = position;
  loaded.api.rememberNativePrice('eth', 100, loaded.clock.now);
  let read, has;
  loaded.context.Tango.GMGN.syncPositionBadges = (callback, _roots, predicate) => { read = callback; has = predicate; };
  loaded.api.syncTrenchPositionBadges();
  const before = JSON.stringify(loaded.api.runtime.state);
  assert.equal(has('eth', ADDRESS_A), true);
  assert.equal(has('bsc', ADDRESS_A), false);
  assert.equal(has('bsc', '12kQB4WCZj1Kr61maq4M1APGSa4ynrjTmYUWWPhppump'), false);
  assert.equal(has('unsupported', ADDRESS_A), false);
  assert.equal(read({ chain: 'bsc', address: '12kQB4WCZj1Kr61maq4M1APGSa4ynrjTmYUWWPhppump' }, () => { throw new Error('stale chain quote must not be read'); }), null);
  assert.equal(read(token, () => detailQuote(1e7, loaded.clock.now)).text, 'Holding 0.1 ETH');
  assert.equal(read(token, () => detailQuote(2e7, loaded.clock.now)).text, 'Holding 0.2 ETH');
  assert.equal(read({ chain: 'eth', address: ADDRESS_B }, () => { throw new Error('unheld quote should not be read'); }), null);
  assert.equal(JSON.stringify(loaded.api.runtime.state), before);
  assert.equal(loaded.calls.buy, 0);
  assert.equal(loaded.calls.sell, 0);
});

test('different trench quick buys settle at their own current card valuations', async () => {
  const addresses = ['12kQB4WCZj1Kr61maq4M1APGSa4ynrjTmYUWWPhppump', 'AE2WNvKXrpBugJEJ57ETSeT8mMdtC1XBtnkU77Aypump'];
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol' });
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('sol', 100, loaded.clock.now);
  for (const [index, address] of addresses.entries()) {
    loaded.api.runtime.gmgnQuotes.set(`sol:${address}`, { chain: 'sol', address, priceUsd: .000002,
      marketCapUsd: 2000, source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE', observedAt: loaded.clock.now });
    await loaded.api.handleQuickBuy({ actionId: `card-${index}`, amountNative: .1,
      token: { chain: 'sol', address, symbol: `TEST${index}`, launchpad: 'pump.fun', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
      quote: { marketCapUsd: 3000 + index * 1000, source: 'GMGN_TRENCH', priceProvenance: 'MARKET_CAP_DERIVED',
        observedAt: loaded.clock.now, valuationMode: 'MARKET_CAP', marketCapDivisor: 1e9 }
    });
  }
  assert.equal(loaded.calls.buy, 2);
  assert.deepEqual(loaded.calls.buyOrders.map(order => order.quote.marketCapUsd), [3000, 4000]);
});

test('unknown-launchpad card entry retains its paper valuation when no exit observation exists', async () => {
  const address = '4Msk7BEHe2Sb2KVaKg1gopMEq5Wuzfm4PkmjD2jFLLu3';
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol' });
  const token = { chain: 'sol', address, symbol: 'STONKD' };
  loaded.api.rememberNativePrice('sol', 100, loaded.clock.now);
  const settings = RealState.normalizeSettings({ slippageBps: 0, platformFeeBps: 0,
    chains: { sol: { networkFeeNative: 0 } } });
  const initial = RealState.createInitialState({ now: 1, initialBalances: { sol: 10 } });
  initial.initialized = true;
  const entry = loaded.api.resolvePaperTradeQuote(token, { marketCapUsd: 37100,
    priceUsd: .0000371, provisionalSupply: 1e9, syntheticTokenPrice: true,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1e9, priceProvenance: 'SYNTHETIC_PRICE',
    source: 'GMGN_TRENCH', observedAt: loaded.clock.now });
  const executableEntry = loaded.api.paperExecutableQuote(token, entry);
  const bought = RealEngine.executeBuy(initial, { token, quote: executableEntry, amountNative: .1 }, settings, loaded.clock.now);
  loaded.api.runtime.state = bought.state;
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.clock.now += 60000;
  await loaded.api.sellPosition(bought.position, 100);
  assert.equal(loaded.calls.sell, 1);
  const exit = loaded.calls.sellOrders[0].quote;
  assert.equal(exit.priceUsd, .0000371, 'missing quote must not reset the entry valuation to default 3200 MC');
  assert.equal(exit.provisional, true);
  assert.equal(exit.priceProvenance, 'POSITION_HISTORY');
  const sold = RealEngine.executeSell(bought.state, { token, quote: exit, percent: 100 }, settings, loaded.clock.now);
  assert.ok(Math.abs(sold.state.accounts.sol.cashBalanceNative - 10) < 1e-10);
  const live = loaded.api.resolvePaperTradeQuote(token, { marketCapUsd: 74200,
    provisionalSupply: 1e9, syntheticTokenPrice: true, source: 'GMGN_TRENCH',
    observedAt: loaded.clock.now }, { position: bought.position });
  assert.equal(live.priceUsd, .0000742, 'fresh card cap still updates an unknown-launchpad provisional holding');
  const correctedSupply = loaded.api.resolvePaperTradeQuote(token, { chain: 'sol', address,
    totalSupply: 1e6, supplySource: 'GMGN_EXACT', source: 'GMGN_DETAIL',
    observedAt: loaded.clock.now }, { position: bought.position });
  assert.equal(correctedSupply.priceUsd, .0371, 'supply-only calibration rebases provisional units instead of freezing the old price');
});

test('drawer sell reuses a fresh exact-token trench snapshot instead of a conflicting cached pair', async () => {
  let snapshot;
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol', readTrenchSnapshot: () => snapshot });
  const address = '12kQB4WCZj1Kr61maq4M1APGSa4ynrjTmYUWWPhppump';
  loaded.api.runtime.settings.confirmationEnabled = false;
  loaded.api.rememberNativePrice('sol', 100, loaded.clock.now);
  const position = { chain: 'sol', tokenAddress: address, symbol: 'CAKE', quantity: 1000,
    costBasisNative: .1, lastPriceUsd: .00002, lastMarketCapUsd: 20000, lastNativePriceUsd: 100,
    totalSupply: 1e9, supplySource: 'GMGN_EXACT' };
  loaded.api.runtime.state.positions[`sol:${address}`] = position;
  loaded.api.runtime.gmgnQuotes.set(`sol:${address}`, { chain: 'sol', address,
    priceUsd: .000026806341, marketCapUsd: 28300, source: 'GMGN_NETWORK',
    priceProvenance: 'OBSERVED_PRICE', observedAt: loaded.clock.now });
  snapshot = { token: { chain: 'sol', address, symbol: 'CAKE', launchpad: 'pump.fun',
    metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
    quote: { marketCapUsd: 28300, source: 'GMGN_TRENCH', observedAt: loaded.clock.now } };
  await loaded.api.sellPosition(position, 25);
  assert.equal(loaded.calls.sell, 1);
  assert.equal(loaded.calls.sellOrders[0].quote.priceUsd, .0000283);
  snapshot.token.address = SOL_ADDRESS;
  await loaded.api.sellPosition(position, 25);
  assert.equal(loaded.calls.sell, 1, 'wrong-token snapshot must not bypass quote coherence');
});

test('rejected mixed quotes expose only bounded public quote diagnostics without changing execution', () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol' });
  const address = '12kQB4WCZj1Kr61maq4M1APGSa4ynrjTmYUWWPhppump';
  const token = { chain: 'sol', address, symbol: 'CAKE' };
  const quote = { chain: 'sol', address, priceUsd: .00002, marketCapUsd: 40000,
    totalSupply: 1e9, supplySource: 'GMGN_EXACT', priceProvenance: 'OBSERVED_PRICE',
    source: 'GMGN_NETWORK', observedAt: loaded.clock.now, privateField: 'must not leak' };
  assert.equal(loaded.api.resolvePaperTradeQuote(token, quote), null);
  const diagnostic = JSON.parse(loaded.host.getAttribute('data-tango-quote-rejection'));
  assert.equal(diagnostic.stage, 'coherence');
  assert.equal(diagnostic.address, address);
  assert.equal(diagnostic.quote.priceUsd, .00002);
  assert.equal(diagnostic.quote.totalSupply, 1e9);
  assert.equal(diagnostic.quote.privateField, undefined);
  assert.equal(loaded.calls.buy, 0);
  assert.equal(loaded.calls.sell, 0);
});

test('legacy Pump holdings accept current trench caps for add buys and drawer exits', async () => {
  const address = '6adymxYgeeb12X7mG3BP7Y7ypPtWFZXLyhm9RGcfpump';
  let snapshot;
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol', readTrenchSnapshot: () => snapshot });
  loaded.api.rememberNativePrice('sol', 105.52, loaded.clock.now);
  const settings = RealState.normalizeSettings({ slippageBps: 0, platformFeeBps: 0,
    chains: { sol: { networkFeeNative: 0 } } });
  const initial = RealState.createInitialState({ now: 1, initialBalances: { sol: 10 } });
  initial.initialized = true;
  const bought = RealEngine.executeBuy(initial, { token: { chain: 'sol', address, symbol: 'OPENAI',
    metadataVerified: true, metadataSource: 'GMGN_TRENCH' }, amountNative: .1,
    quote: { priceUsd: .0000321, marketCapUsd: 32100, nativePriceUsd: 105.52,
      observedAt: loaded.clock.now, nativePriceObservedAt: loaded.clock.now,
      source: 'GMGN_TRENCH_MC', totalSupply: 1e9, supplySource: 'LEGACY_PUMP_RULE',
      marketCapDivisor: 1e9, valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED' }
  }, settings, loaded.clock.now);
  const position = bought.position;
  loaded.api.runtime.state = bought.state;
  loaded.context.Tango.Store.executeSell = async order => {
    loaded.calls.sell += 1; loaded.calls.sellOrders.push(order);
    return { state: loaded.api.runtime.state, trade: {} };
  };
  loaded.context.Tango.Engine = RealEngine;
  const card = { chain: 'sol', address, marketCapUsd: 34900, source: 'GMGN_TRENCH',
    observedAt: loaded.clock.now, priceProvenance: 'MARKET_CAP_DERIVED', priceObservedAt: 0 };
  const currentToken = { chain: 'sol', address, symbol: 'OPENAI', launchpad: 'Pump.fun',
    metadataVerified: true, metadataSource: 'GMGN_TRENCH' };
  const current = loaded.api.resolvePaperTradeQuote(currentToken, card);
  assert.equal(current.supplySource, 'LAUNCHPAD_RULE', 'verified current rules supersede legacy compatibility');
  assert.equal(RealEngine.validateQuote(current, loaded.clock.now, undefined, position,
    loaded.api.executionValidationTrustContext(position, currentToken)).ok, true);
  const legacy = loaded.api.resolvePaperTradeQuote({ chain: 'sol', address }, card);
  assert.equal(RealEngine.validateQuote(legacy, loaded.clock.now, undefined, position).ok, true,
    'a verified legacy position with a live same-token card remains executable');
  assert.equal(legacy.priceUsd, .0000349);
  const mayhem = loaded.api.resolvePaperTradeQuote({ ...currentToken, launchMode: 'mayhem' }, card);
  assert.equal(mayhem.totalSupply, 2e9, 'old canonical supply must not mask verified current launch mode');
  snapshot = { token: { ...currentToken, launchpad: '' }, quote: card };
  loaded.api.runtime.settings.confirmationEnabled = false;
  await loaded.api.sellPosition(position, 25);
  assert.equal(loaded.calls.sell, 1);
  const sold = RealEngine.executeSell(loaded.api.runtime.state, loaded.calls.sellOrders[0], settings, loaded.clock.now);
  assert.ok(Math.abs(sold.trade.amountNative - position.quantity * .25 * .0000349 / 105.52) < 1e-8);
});

test('trench drawer and portfolio reuse the same fresh card valuation without rewriting positions', () => {
  let snapshot;
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=eth', readTrenchSnapshot: () => snapshot });
  const position = { chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'TEST', name: 'Test',
    quantity: 1000, costBasisNative: .1, lastPriceUsd: .01, averageEntryPriceUsd: .01,
    lastNativePriceUsd: 100, lastMarketCapUsd: 1e7, totalSupply: 1e9,
    marketCapDivisor: 1e9, supplySource: 'GMGN_EXACT', valuationMode: 'PRICE', openedAt: 1 };
  loaded.api.runtime.state.positions = { [`eth:${ADDRESS_A}`]: position };
  loaded.api.runtime.state.accounts.eth.cashBalanceNative = 9.9;
  loaded.api.rememberNativePrice('eth', 100, loaded.clock.now);
  loaded.api.runtime.drawerOpen = true;
  snapshot = { token: { chain: 'eth', address: ADDRESS_A, symbol: 'TEST', metadataVerified: true,
    metadataSource: 'GMGN_TRENCH' }, quote: { chain: 'eth', address: ADDRESS_A,
    priceUsd: .02, marketCapUsd: 2e7, totalSupply: 1e9, supplySource: 'GMGN_EXACT',
    source: 'GMGN_TRENCH', priceProvenance: 'OBSERVED_PRICE', nativePriceUsd: 100,
    observedAt: loaded.clock.now, nativePriceObservedAt: loaded.clock.now } };
  const before = JSON.stringify(loaded.api.runtime.state);
  const live = loaded.api.freshExecutableQuote(position);
  assert.equal(live?.priceUsd, .02, 'drawer must not retain the old .01 mark');
  const summary = RealEngine.portfolioSummary(loaded.api.runtime.state, 'eth', 100, loaded.api.freshExecutableQuote);
  assert.ok(Math.abs(summary.positionsValueNative - .2) < 1e-10);
  assert.ok(Math.abs(summary.totalPnlNative - .1) < 1e-10);
  assert.match(loaded.api.renderDrawer(summary), /value[^<]*0\.2 ETH/);
  loaded.api.runtime.settings.displayCurrency = 'USD';
  assert.match(loaded.api.renderBar(summary), /\$0/);
  assert.match(loaded.api.renderDrawer(summary), /value[^<]*\$20/);
  assert.equal(JSON.stringify(loaded.api.runtime.state), before);
  snapshot.quote.observedAt = loaded.clock.now - 60000;
  assert.equal(loaded.api.freshExecutableQuote(position), null, 'expired card must fall back to the stored mark');
  snapshot.quote.observedAt = loaded.clock.now;
  snapshot.token.address = ADDRESS_B;
  assert.equal(loaded.api.freshExecutableQuote(position), null, 'wrong-token card must not affect valuation');
  snapshot.token.address = ADDRESS_A;
  snapshot.token.chain = 'bsc';
  assert.equal(loaded.api.freshExecutableQuote(position), null, 'same address on another chain is not a valid mark');
  snapshot.token.chain = 'eth';
  loaded.api.runtime.current = { token: { ...snapshot.token, metadataSource: 'GMGN_DETAIL' },
    quote: { ...snapshot.quote, priceUsd: .03, marketCapUsd: 3e7, source: 'GMGN_DETAIL' } };
  assert.equal(loaded.api.freshExecutableQuote(position)?.priceUsd, .03, 'current detail quote takes precedence over a card');
});

test('supply-only refresh must not rebase a held market-cap position using its old historical price', () => {
  const loaded = loadContent({ href: 'https://gmgn.ai/?chain=sol' });
  const address = '93yT1tgjPH1YBBQxyFQjmg3eGoA213m8fJ6x3tf3pump';
  const token = { chain: 'sol', address, symbol: 'BEYOND', launchpad: 'Pump.fun', metadataVerified: true, metadataSource: 'GMGN_TRENCH' };
  loaded.api.rememberNativePrice('sol', 105, loaded.clock.now);
  const fees = RealState.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, chains: { sol: { networkFeeNative: 0 } } });
  const first = RealEngine.executeBuy(RealState.createInitialState({ now: 1 }), { token, amountNative: .1,
    quote: { priceUsd: .0000389, marketCapUsd: 38900, nativePriceUsd: 105,
      observedAt: loaded.clock.now, nativePriceObservedAt: loaded.clock.now, source: 'GMGN_TRENCH',
      totalSupply: 1e9, supplySource: 'LAUNCHPAD_RULE', launchpad: 'Pump.fun',
      valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED' } }, fees, loaded.clock.now);
  loaded.api.runtime.state = first.state;
  const supplyOnly = { chain: 'sol', address, totalSupply: 978294757,
    supplySource: 'GMGN_NETWORK_EXACT', totalSupplySource: 'GMGN_NETWORK_EXACT',
    totalSupplyObservationSource: 'GMGN_NETWORK', totalSupplyObservedAt: loaded.clock.now,
    marketCapUsd: 38900, marketCapSource: 'GMGN_DETAIL', marketCapObservedAt: loaded.clock.now - 100,
    source: 'GMGN_NETWORK', observedAt: loaded.clock.now, priceObservedAt: 0, priceUsd: 0 };
  const q = loaded.api.resolvePaperTradeQuote(token, supplyOnly, { position: first.position });
  assert.ok(q);
  const before = RealEngine.markPosition(first.position, undefined, 105).valueNative;
  const result = RealEngine.calibratePosition(first.state, token, q, loaded.clock.now);
  const after = RealEngine.markPosition(result.positions[`sol:${address}`], q, 105).valueNative;
  assert.ok(Math.abs(after - before) < 1e-10, `supply-only observation changed value ${before} -> ${after}`);
  assert.doesNotThrow(() => RealState.normalizeState(result, fees, { strict: true }));
  const withoutLaunchpad = loaded.api.resolvePaperTradeQuote({ ...token, launchpad: '',
    metadataVerified: false, metadataSource: '' }, supplyOnly, { position: first.position });
  const retained = RealEngine.calibratePosition(first.state, token, withoutLaunchpad, loaded.clock.now);
  assert.ok(Math.abs(RealEngine.markPosition(retained.positions[`sol:${address}`], withoutLaunchpad, 105).valueNative - before) < 1e-10);
  assert.doesNotThrow(() => RealState.normalizeState(retained, fees, { strict: true }));
  for (const usePrice of [false, true]) {
    const coherent = { ...supplyOnly, marketCapSource: 'GMGN_NETWORK',
      marketCapObservedAt: loaded.clock.now,
      ...(usePrice ? { priceUsd: 38900 / 978294757, priceObservedAt: loaded.clock.now,
        priceSource: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE' } : {}) };
    const accepted = loaded.api.resolvePaperTradeQuote(token, coherent, { position: first.position });
    assert.equal(accepted.totalSupply, 978294757, 'coherent observations must still upgrade supply');
    const calibrated = RealEngine.calibratePosition(first.state, token, accepted, loaded.clock.now);
    const value = RealEngine.markPosition(calibrated.positions[`sol:${address}`], accepted, 105).valueNative;
    assert.ok(Math.abs(value - before) < 1e-10, 'supported supply upgrade must remain neutral');
    assert.doesNotThrow(() => RealState.normalizeState(calibrated, fees, { strict: true }));
  }
});

test('fresh generic GMGN market caps survive fallback order transport on all six chains',async()=>{
 for(const chain of ['sol','bsc','eth','base','robinhood','xlayer']){
  const address=chain==='sol'?SOL_ADDRESS:ADDRESS_A;
  const loaded=loadContent({href:'https://gmgn.ai/'+chain+'/token/'+address});
  loaded.api.rememberNativePrice(chain,100,loaded.clock.now);
  const token={chain,address,symbol:'CAP',metadataVerified:true,metadataSource:'GMGN_DETAIL'};
  const q=loaded.api.resolvePaperTradeQuote(token,{chain,address,marketCapUsd:59677.668,source:'GMGN',observedAt:loaded.clock.now});
  const initial=RealState.createInitialState({now:1});initial.initialized=true;
  const settings=RealState.normalizeSettings({slippageBps:0,platformFeeBps:0,chains:{[chain]:{networkFeeNative:0}}});
  const values={[global.Tango.STORAGE_KEY]:initial,[global.Tango.SETTINGS_KEY]:settings};
  const coordinator=StateCoordinator.create({readRaw:async keys=>Object.fromEntries(keys.map(k=>[k,structuredClone(values[k])])),writeRaw:async next=>Object.assign(values,structuredClone(next)),now:()=>loaded.clock.now});
  const result=await coordinator.mutate(structuredClone({type:'EXECUTE_BUY',order:{token,quote:q,amountNative:.1}}));
  assert.equal(q.marketCapUsd,59677.668,chain+' resolver');
  assert.equal(result.trade.marketCapUsd,59677.668,chain+' serialized execution must retain visible observed cap');
  assert.doesNotThrow(()=>RealState.normalizeState(result.state,settings,{strict:true}));
 }
});

for(const chain of ['sol','bsc','robinhood','xlayer']) test('detail live cap updates panel drawer and total profit together without awaiting storage: '+chain,()=>{
 const address=chain==='sol'?SOL_ADDRESS:ADDRESS_A;
 let snapshot;
 const loaded=loadContent({href:'https://gmgn.ai/'+chain+'/token/'+address,readVerifiedCurrentTokenSnapshot:()=>snapshot});
 loaded.context.Tango.Engine=RealEngine;
 loaded.api.rememberNativePrice(chain,100,loaded.clock.now);
 const token={chain,address,symbol:'LIVE',metadataVerified:true,metadataSource:'GMGN_DETAIL'};
 const original={...Supply.fallbackValuation(token),chain,address,priceUsd:.00001,marketCapUsd:10000,
   marketCapDivisor:1e9,provisionalSupply:1e9,nativePriceUsd:100,
   observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,originalObservedAt:loaded.clock.now,
   marketCapSource:'GMGN',marketCapObservedAt:loaded.clock.now,source:'TANGO_FALLBACK_CARD_MARKET_CAP',
   valuationSource:'CARD_MARKET_CAP_FALLBACK_SUPPLY',valuationMode:'MARKET_CAP',
   priceProvenance:'FALLBACK_INITIAL_MARKET_CAP',syntheticTokenPrice:true,provisional:true,paperFallback:true};
 const settings=RealState.normalizeSettings({slippageBps:0,platformFeeBps:0,chains:{[chain]:{networkFeeNative:0}}});
 const initial=RealState.createInitialState({now:1});initial.initialized=true;
 const bought=RealEngine.executeBuy(initial,{token,quote:original,amountNative:.1},settings,loaded.clock.now);
 loaded.api.runtime.state=bought.state;loaded.api.runtime.drawerOpen=true;
 loaded.api.runtime.current={token,quote:{chain,address,marketCapUsd:20000,source:'GMGN',observedAt:loaded.clock.now}};
 const position=bought.position,before=JSON.stringify(bought.state);
 let live=loaded.api.freshExecutableQuote(position);
 assert.ok(live, 'observed market cap is usable even when exact supply is not available');
 let summary=RealEngine.portfolioSummary(bought.state,chain,100,loaded.api.freshExecutableQuote);
 assert.ok(Math.abs(summary.positionsValueNative-.2)<1e-9);
 assert.match(loaded.api.renderPanel(), /totalProfit<\/span><strong[^>]*>0\.1 /);
 assert.match(loaded.api.renderDrawer(summary), /value[^<]*0\.2 /);
 snapshot={token,quote:{chain,address,priceUsd:.00003,marketCapUsd:30000,totalSupply:1e9,supplySource:'GMGN_EXACT',priceProvenance:'OBSERVED_PRICE',source:'GMGN',observedAt:loaded.clock.now}};
 assert.equal(loaded.api.refreshDetailDisplayQuote(),true);
 summary=RealEngine.portfolioSummary(bought.state,chain,100,loaded.api.freshExecutableQuote);
 assert.ok(Math.abs(summary.positionsValueNative-.3)<1e-9);
 assert.ok(Math.abs(Number(loaded.api.renderPanel().match(/totalProfit<\/span><strong[^>]*>([\d.]+)/)[1])-.2)<1e-9);
 assert.ok(Math.abs(Number(loaded.api.renderDrawer(summary).match(/value[^<]*?([\d.]+) /)[1])-.3)<1e-9);
 assert.equal(JSON.stringify(bought.state),before,'display must not mutate cash or positions');
});

for(const chain of ['sol','bsc','eth','base','robinhood','xlayer'])test('detail market-cap-only commit overrides conflicting network valuation: '+chain,async()=>{
 const address=chain==='sol'?SOL_ADDRESS:ADDRESS_A;let loaded;
 const token={chain,address,symbol:'CAP',metadataVerified:true,metadataSource:'GMGN_DETAIL'};
 loaded=loadContent({href:'https://gmgn.ai/'+chain+'/token/'+address,readVerifiedCurrentTokenSnapshot:()=>({token,quote:{chain,address,priceUsd:0,priceObservedAt:0,priceSource:'',priceProvenance:'',marketCapUsd:30000,marketCapObservedAt:loaded.clock.now,marketCapSource:'GMGN',source:'GMGN',observedAt:loaded.clock.now}})});
 loaded.api.runtime.settings.confirmationEnabled=false;loaded.api.rememberNativePrice(chain,100,loaded.clock.now);
 const settings=RealState.normalizeSettings({slippageBps:0,platformFeeBps:0,chains:{[chain]:{networkFeeNative:0}}});
 const initial=RealState.createInitialState({now:1});initial.initialized=true;
 const original=loaded.api.resolvePaperTradeQuote(token,{chain,address,marketCapUsd:30000,source:'GMGN',observedAt:loaded.clock.now});
 const bought=RealEngine.executeBuy(initial,{token,quote:original,amountNative:.1},settings,loaded.clock.now);loaded.api.runtime.state=bought.state;
 const network={chain,address,priceUsd:.000004345,marketCapUsd:4345,source:'GMGN_NETWORK',observedAt:loaded.clock.now,priceObservedAt:loaded.clock.now,marketCapObservedAt:loaded.clock.now,priceSource:'GMGN_NETWORK',marketCapSource:'GMGN_NETWORK',priceProvenance:'OBSERVED_PRICE'};
 loaded.api.runtime.gmgnQuotes.set(chain+':'+address,network);loaded.api.runtime.current={token,quote:network};
 await loaded.api.sell(25);assert.equal(loaded.calls.sell,1);assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd,30000);assert.ok(Math.abs(loaded.calls.sellOrders[0].quote.priceUsd-.00003)<1e-12);
});

test('market-cap-only commit rejects stale untrusted and mismatched DOM snapshots',async()=>{
 const cases=[{quote:{chain:'bsc'}},{quote:{address:ADDRESS_B}},{quote:{source:'PAGE_TEXT'}},{quote:{marketCapSource:'GMGN_NETWORK'}},{quote:{marketCapObservedAt:0}},{quote:{marketCapObservedAt:-1}},{quote:{marketCapUsd:0}},{token:{metadataVerified:false}},{token:{metadataSource:'GMGN_NETWORK'}},{stale:true},{future:true}];
 for(const extra of cases){let loaded;
  loaded=loadContent({readVerifiedCurrentTokenSnapshot:()=>({token:{chain:'eth',address:ADDRESS_A,symbol:'TEST',metadataVerified:true,metadataSource:'GMGN_DETAIL',...extra.token},quote:{...detailQuote(30000,loaded.clock.now),priceUsd:0,priceObservedAt:0,priceSource:'',priceProvenance:'',...extra.quote,...(extra.stale?{marketCapObservedAt:loaded.clock.now-20000}:{}),...(extra.future?{marketCapObservedAt:loaded.clock.now+6000}:{})}})});
  seedHeldDetailPosition(loaded,4345);await loaded.api.sell(25);assert.equal(loaded.calls.sell,1,JSON.stringify(extra));assert.equal(loaded.calls.sellOrders[0].quote.marketCapUsd,4345,JSON.stringify(extra));
 }
});

test('detail valuation does not override a coherent held mark with an expired native rate',()=>{
 const loaded=loadContent({href:'https://gmgn.ai/xlayer/token/'+ADDRESS_A});loaded.context.Tango.Engine=RealEngine;
 const token={chain:'xlayer',address:ADDRESS_A,symbol:'RATE',metadataVerified:true,metadataSource:'GMGN_DETAIL'};
 const settings=RealState.normalizeSettings({slippageBps:0,platformFeeBps:0,chains:{xlayer:{networkFeeNative:0}}});
 const state=RealState.createInitialState({now:1});state.initialized=true;
 const quote={chain:'xlayer',address:ADDRESS_A,priceUsd:.00001,marketCapUsd:10000,totalSupply:1e9,supplySource:'GMGN_EXACT',nativePriceUsd:100,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN',priceProvenance:'OBSERVED_PRICE'};
 const buy=RealEngine.executeBuy(state,{token,quote,amountNative:.1},settings,loaded.clock.now);loaded.api.runtime.state=buy.state;
 loaded.api.runtime.current={token,quote:{chain:'xlayer',address:ADDRESS_A,priceUsd:0,marketCapUsd:0,source:'GMGN',observedAt:loaded.clock.now}};
 loaded.api.runtime.nativePrices.set('xlayer',140);loaded.api.runtime.nativePriceObservedAt.set('xlayer',loaded.clock.now-20000);
 assert.match(loaded.api.renderPanel(),/totalProfit<\/span><strong[^>]*>0 OKB/);
 loaded.api.runtime.settings.displayCurrency='USD';
 assert.match(loaded.api.renderPanel(),/totalBuy<\/span><strong[^>]*>0\.1 OKB/,'expired native rate cannot convert USD cost');
 loaded.api.runtime.settings.displayCurrency='NATIVE';
 loaded.api.rememberNativePrice('xlayer',200,loaded.clock.now);
 assert.match(loaded.api.renderPanel(),/totalProfit<\/span><strong[^>]*>-0\.05 OKB/,'fresh native market moves must still affect value');
});
for(const chain of ['sol','bsc','eth','base','robinhood','xlayer'])test('known-supply market-cap quote updates live valuation without waiting for durable writes: '+chain,()=>{
 const address=chain==='sol'?SOL_ADDRESS:ADDRESS_A;const loaded=loadContent({href:'https://gmgn.ai/'+chain+'/token/'+address});loaded.context.Tango.Engine=RealEngine;loaded.api.rememberNativePrice(chain,100,loaded.clock.now);
 const token={chain,address,symbol:'CAP',metadataVerified:true,metadataSource:'GMGN_DETAIL'},settings=RealState.normalizeSettings({slippageBps:0,platformFeeBps:0,chains:{[chain]:{networkFeeNative:0}}}),state=RealState.createInitialState({now:1});state.initialized=true;
 const q={chain,address,priceUsd:.00001,marketCapUsd:10000,totalSupply:1e9,supplySource:'GMGN_EXACT',nativePriceUsd:100,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN',priceProvenance:'OBSERVED_PRICE'};
 const buy=RealEngine.executeBuy(state,{token,quote:q,amountNative:.1},settings,loaded.clock.now);loaded.api.runtime.state=buy.state;
 loaded.api.runtime.current={token,quote:{chain,address,priceUsd:.00002,priceProvenance:'MARKET_CAP_DERIVED',marketCapUsd:20000,marketCapSource:'GMGN_NETWORK',marketCapObservedAt:loaded.clock.now,totalSupply:1e9,supplySource:'GMGN_NETWORK_EXACT',totalSupplySource:'GMGN_NETWORK_EXACT',totalSupplyObservedAt:loaded.clock.now,totalSupplyObservationSource:'GMGN_NETWORK',source:'GMGN_NETWORK',observedAt:loaded.clock.now}};
 const resolved=loaded.api.freshExecutableQuote(buy.position);assert.ok(resolved);assert.equal(resolved.marketCapUsd,20000);assert.ok(Math.abs(RealEngine.markPosition(buy.position,resolved,100).valueNative-.2)<1e-10);
});

test('tutorial replaces calendar footer while history and detail trading remain available', () => {
 const loaded=loadContent();seedHeldDetailPosition(loaded);loaded.api.runtime.calendarOpen=true;
 const calendar=loaded.api.renderPnlCalendar(), panel=loaded.api.renderPanel();
 for(const html of [calendar]){assert.ok(html.includes('href="https://t.co/H2RSVQV4sX"'));assert.match(html,/target="_blank"/);assert.match(html,/rel="noopener noreferrer"/);}
 assert.doesNotMatch(calendar,/data-action="dashboard-calendar"/);assert.match(calendar,/data-action="dashboard-history"/);assert.match(panel,/data-action="trade-replay"/);assert.ok(!panel.includes('tango-tutorial-link'));assert.ok(!calendar.includes('👇'));
});


test('native quote refresh contains synchronous and asynchronous invalidated contexts without retrying', async () => {
  for (const mode of ['sync', 'reject']) {
    const loaded=loadContent({sendMessage(){const e=new Error('Extension context invalidated.');if(mode==='sync')throw e;return Promise.reject(e);}});
    const before=JSON.stringify(loaded.api.runtime.state);
    assert.doesNotThrow(()=>loaded.api.ensureNativePrice(quoteContext()));
    await loaded.api.runtime.nativePricePromises.get('eth');
    assert.equal(loaded.api.runtime.nativePricePromises.size,0);
    loaded.api.ensureNativePrice(quoteContext());
    await loaded.api.runtime.nativePricePromises.get('eth');
    assert.equal(loaded.messages.length,1,'dead context is not retried');
    assert.equal(JSON.stringify(loaded.api.runtime.state),before,'quotes do not change the account');
  }
});
test('token quote refresh contains a synchronous invalidated runtime',async()=>{
 const loaded=loadContent({sendMessage(){throw new Error('Extension context invalidated.');}});
 assert.doesNotThrow(()=>loaded.api.ensureTokenQuote(quoteContext()));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(loaded.api.runtime.quoteRequests.size,0);
});
test('transient native quote failures can recover on the next refresh',async()=>{
 let attempt=0; const loaded=loadContent({sendMessage(){if(++attempt===1)throw new Error('Receiving end does not exist.');return Promise.resolve({price:3000,observedAt:1000000});}});
 assert.doesNotThrow(()=>loaded.api.ensureNativePrice(quoteContext()));
 await loaded.api.runtime.nativePricePromises.get('eth');
 loaded.api.ensureNativePrice(quoteContext());await loaded.api.runtime.nativePricePromises.get('eth');
 assert.equal(attempt,2);assert.equal(loaded.api.freshNativePrice('eth'),3000);
});
test('quote interval contains coordinator context invalidation and skips later ticks',async()=>{
 const loaded=loadContent();let reads=0;
 loaded.context.Tango.GMGN.readCurrentToken=async()=>{reads++;throw new Error('extensionReloadRequired');};
 await assert.doesNotReject(loaded.api.tickQuote());
 await loaded.api.tickQuote();assert.equal(reads,1);
});
test('settings refresh does not schedule retries for an invalidated extension context',async()=>{
 const timers=[];const errors=[];const loaded=loadContent({timer(callback){timers.push(callback);return timers.length;},logger:{error(...args){errors.push(args);},log(){},warn(){}}});
 loaded.context.Tango.Store.getAll=async()=>{throw new Error('extensionReloadRequired');};
 assert.equal(await loaded.api.refreshRecoverably(),false);
 assert.equal(timers.length,0);assert.equal(errors.length,0);
});


test('startup invalidation never rearms the quote interval',async()=>{
 const loaded=loadContent({sendMessage(){throw new Error('Extension context invalidated.');}});const intervals=[];
 loaded.context.setInterval=(callback,delay)=>{intervals.push(delay);return intervals.length;};
 await assert.doesNotReject(loaded.api.start());
 assert.equal(loaded.api.runtime.quoteTimer,null);assert.ok(!intervals.includes(3000));
});
test('quote tick still reports unrelated programming errors',async()=>{
 const loaded=loadContent();loaded.context.Tango.GMGN.readCurrentToken=async()=>{throw new Error('unexpected test defect');};
 await assert.rejects(loaded.api.tickQuote(),/unexpected test defect/);
 assert.equal(loaded.api.runtime.extensionInvalidated,false);
});
test('detail holdings show native value from the same mark in all six chains even in USD mode',()=>{
 for(const chain of Chains.all()){
  const address=chain.id==='sol'?SOL_ADDRESS:ADDRESS_A;
  const loaded=loadContent({href:'https://gmgn.ai/'+chain.gmgnSlug+'/token/'+address});
  seedHeldDetailPosition(loaded);
  const position=loaded.api.runtime.state.positions['eth:'+ADDRESS_A];
  delete loaded.api.runtime.state.positions['eth:'+ADDRESS_A];
  Object.assign(position,{chain:chain.id,tokenAddress:address,quantity:12,lastPriceUsd:1,averageEntryPriceUsd:1,lastNativePriceUsd:3,costBasisNative:3});
  loaded.api.runtime.state.positions[chain.id+':'+address]=position;
  loaded.api.runtime.current={token:{chain:chain.id,address,symbol:'TEST'},quote:{chain:chain.id,address,priceUsd:1,nativePriceUsd:3,nativePriceObservedAt:loaded.clock.now,observedAt:loaded.clock.now,source:'GMGN_DETAIL',priceProvenance:'OBSERVED_PRICE',valuationMode:'PRICE'}};
  loaded.api.runtime.gmgnQuotes.clear();loaded.api.runtime.settings.displayCurrency='USD';
  const before=JSON.stringify(loaded.api.runtime.state);
  const html=loaded.api.renderPanel();
  assert.match(html,/class="tango-held-quantity">12 TEST<\/span>/);
  assert.ok(html.includes('class="tango-held-native">· ≈4 '+chain.nativeSymbol+'</span>'),chain.id+': '+html.match(/class="tango-held-native">[^<]*/)?.[0]);
  assert.equal(JSON.stringify(loaded.api.runtime.state),before);
  assert.match(html,/data-sell="100"/);assert.match(html,/data-action="breakeven"/);
 }
});
test('detail holdings update with the existing mark and do not invent a value without prices',()=>{
 const loaded=loadContent();seedHeldDetailPosition(loaded);
 const p=loaded.api.runtime.state.positions['eth:'+ADDRESS_A];
 loaded.api.runtime.current.quote={chain:'eth',address:ADDRESS_A,priceUsd:1,nativePriceUsd:3,nativePriceObservedAt:loaded.clock.now,observedAt:loaded.clock.now,source:'GMGN_DETAIL',priceProvenance:'OBSERVED_PRICE',valuationMode:'PRICE'};loaded.api.runtime.gmgnQuotes.clear();
 Object.assign(p,{quantity:12,lastPriceUsd:1,averageEntryPriceUsd:1,lastNativePriceUsd:3});
 assert.match(loaded.api.renderPanel(),/class="tango-held-native">· ≈4 ETH<\/span>/);
 p.quantity=6;assert.match(loaded.api.renderPanel(),/class="tango-held-native">· ≈2 ETH<\/span>/);
 p.lastNativePriceUsd=0;loaded.api.runtime.current.quote={};
 assert.match(loaded.api.renderPanel(),/class="tango-held-native">· —<\/span>/);
 delete loaded.api.runtime.state.positions['eth:'+ADDRESS_A];
 assert.match(loaded.api.renderPanel(),/class="tango-held-native">· ≈0 ETH<\/span>/);
});


test('daily bar uses only current local day and chain, preserves account and calendar', () => {
  const loaded = loadContent();
  const date = new Date(loaded.clock.now);
  const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  loaded.api.runtime.state.dailyRealizedByChain = { eth: { [key]: { native: 0.25, usdAtExecution: 20 }, '1900-01-01': { native: 99 } }, sol: { [key]: { native: 50 } } };
  const before = JSON.stringify(loaded.api.runtime.state);
  const bar = loaded.api.renderBar({ totalPnlNative: 100, todayPnlNative: 999, positionCount: 2 });
  assert.match(bar, /0\.25 ETH/);
  assert.match(bar, /todayPnl/);
  assert.doesNotMatch(bar, /100 ETH|999 ETH|50 ETH/);
  assert.equal(JSON.stringify(loaded.api.runtime.state), before);
  loaded.clock.now = new Date(date.getFullYear(), date.getMonth(), date.getDate()+1).getTime();
  const next = loaded.api.renderBar({ totalPnlNative: 100, todayPnlNative: 999, positionCount: 2 });
  assert.doesNotMatch(next, /\+0\.25 ETH|999 ETH/);
  assert.match(next, /0 ETH/);
  assert.equal(JSON.stringify(loaded.api.runtime.state), before);
});

test('daily bar USD matches calendar conversion and collapsed negative values', () => {
  const loaded = loadContent();
  const date = new Date(loaded.clock.now);
  const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  loaded.api.runtime.state.dailyRealizedByChain = { eth: { [key]: { native: -0.25, usdAtExecution: -20 } } };
  loaded.api.runtime.settings.displayCurrency = 'USD';
  loaded.api.runtime.settings.barCollapsed = true;
  loaded.api.rememberNativePrice('eth', 200, loaded.clock.now);
  loaded.calls.chainUsdSummaries.length = 0;
  assert.match(loaded.api.renderBar({ totalPnlNative: 999, positionCount: 0 }), /-\$50/);
  assert.equal(loaded.calls.chainUsdSummaries.length, 0, 'daily bar avoids a full portfolio USD scan');
});

test('daily rollover schedules one render without a trade or account reset', () => {
  const loaded = loadContent();
  loaded.api.renderBar({ totalPnlNative: 100, positionCount: 0 });
  loaded.api.runtime.renderQueued = false;
  loaded.api.refreshDailyPnl();
  assert.equal(loaded.api.runtime.renderQueued, false);
  const before = JSON.stringify(loaded.api.runtime.state);
  loaded.clock.now += 86400000;
  loaded.api.refreshDailyPnl();
  assert.equal(loaded.api.runtime.renderQueued, true);
  assert.equal(JSON.stringify(loaded.api.runtime.state), before);
});


test('daily bar keeps all six chain ledgers separate and handles empty days', () => {
  for (const chain of Chains.all()) {
    const loaded = loadContent({ href: `https://gmgn.ai/?chain=${chain.id}` });
    const date = new Date(loaded.clock.now);
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    loaded.api.runtime.state.dailyRealizedByChain = Object.fromEntries(Chains.all().map(c=>[c.id,{ [key]: {native:c.id === chain.id ? 0.125 : 88} }]));
    const before = JSON.stringify(loaded.api.runtime.state);
    assert.match(loaded.api.renderBar({ totalPnlNative: 99, positionCount: 0 }), new RegExp(`0\\.125 ${chain.nativeSymbol}`));
    assert.equal(JSON.stringify(loaded.api.runtime.state), before);
    delete loaded.api.runtime.state.dailyRealizedByChain[chain.id][key];
    assert.match(loaded.api.renderBar({ totalPnlNative: 99, positionCount: 0 }), new RegExp(`0 ${chain.nativeSymbol}`));
  }
});


function resizeFixture(loaded, kind='panel', edge='e') {
 const element=eventElement();element.style={};element.getBoundingClientRect=()=>({left:100,top:100,width:400,height:400,right:500,bottom:500});
 const handle=eventElement({dataset:{resizeKind:kind,resizeEdge:edge}});
 loaded.shadowSingles.set(`.tango-${kind}`,element);loaded.shadowLists.set(`[data-resize-kind="${kind}"]`,[handle]);
 loaded.api.bindResizable(kind);return {element,handle};
}
function resizeEvent(x=500,y=500,extra={}) {return {isTrusted:true,button:0,clientX:x,clientY:y,preventDefault(){},stopPropagation(){},...extra};}

test('floating resize persists layout only without account mutations',async()=>{
 const l=loadContent(),{element,handle}=resizeFixture(l),before=JSON.stringify(l.api.runtime.state);
 handle.emit('pointerdown',resizeEvent());assert.equal(l.api.runtime.floatingGesture,true);
 l.windowListeners.get('pointermove')(resizeEvent(580,500));
 assert.equal(l.api.runtime.settings.panelScale,1.2);assert.equal(element.style.zoom,'1.2');assert.equal(l.calls.patches.length,0);
 await l.windowListeners.get('pointerup')(resizeEvent());assert.equal(l.calls.patches.length,1);assert.equal(l.calls.patches[0].panelScale,1.2);
 assert.equal(l.api.runtime.floatingGesture,false);assert.equal(l.windowListeners.has('pointermove'),false);
 assert.equal(JSON.stringify(l.api.runtime.state),before);assert.equal(l.calls.buyOrders.length+l.calls.sellOrders.length,0);
});
test('resize cancels without saving and keeps unrelated settings',async()=>{
 const l=loadContent();l.api.runtime.settings.panelScale=1;const {handle}=resizeFixture(l,'panel','nw');
 handle.emit('pointerdown',resizeEvent(100,100));l.windowListeners.get('pointermove')(resizeEvent(60,60));
 assert.equal(l.api.runtime.settings.panelScale,1.1);l.api.runtime.settings.soundEnabled=false;
 await l.windowListeners.get('pointercancel')(resizeEvent(60,60,{type:'pointercancel'}));
 assert.equal(l.api.runtime.settings.panelScale,1);assert.equal(l.api.runtime.settings.soundEnabled,false);
 assert.equal(l.calls.patches.length,0);assert.equal(l.api.runtime.floatingGesture,false);
});
test('resize ignores synthetic and secondary input and clamps size',async()=>{
 const l=loadContent(),{handle}=resizeFixture(l);
 handle.emit('pointerdown',resizeEvent(500,500,{isTrusted:false}));assert.equal(l.windowListeners.has('pointermove'),false);
 handle.emit('pointerdown',resizeEvent(500,500,{button:2}));assert.equal(l.windowListeners.has('pointermove'),false);
 handle.emit('pointerdown',resizeEvent());l.windowListeners.get('pointermove')(resizeEvent(-999,-999));assert.equal(l.api.runtime.settings.panelScale,.75);
 l.windowListeners.get('pointermove')(resizeEvent(9999,9999));assert.ok(l.api.runtime.settings.panelScale<=1.5);
 await l.windowListeners.get('pointerup')(resizeEvent());
});
test('resize save failure recovers without an unhandled rejection',async()=>{
 const l=loadContent({patchSettings:async()=>{throw new Error('write failed');}}),{handle}=resizeFixture(l);
 handle.emit('pointerdown',resizeEvent());l.windowListeners.get('pointermove')(resizeEvent(550,500));
 await assert.doesNotReject(l.windowListeners.get('pointerup')(resizeEvent()));assert.equal(l.calls.getAll,1);
 assert.equal(l.api.runtime.toast.message,'settingsSaveFailed');assert.equal(l.api.runtime.floatingGesture,false);
});
test('floating layout uses screen-coordinate positions and resets independently',async()=>{
 const l=loadContent();l.api.runtime.settings.panelScale=1.5;l.api.runtime.settings.barScale=.8;l.api.runtime.settings.panelPosition={x:150,y:90};
 assert.match(l.api.floatingLayoutStyle('panel'),/left:100px;top:60px/);assert.match(l.api.floatingLayoutStyle('panel'),/zoom:1.5/);
 await l.api.resetFloatingScale('panel');assert.equal(l.calls.patches.at(-1).panelScale,1);assert.equal(l.api.runtime.settings.barScale,.8);
 assert.equal(l.api.runtime.settings.panelPosition.x,150);
});
test('both floating surfaces expose eight resize edges and a default-size button',()=>{
 const l=loadContent(),bar=l.api.renderBar({positionCount:0});assert.equal((bar.match(/data-resize-edge=/g)||[]).length,8);assert.match(bar,/data-action="reset-bar-size"/);
 l.api.runtime.current={token:{chain:'eth',address:ADDRESS_A,symbol:'TEST'},quote:null};const panel=l.api.renderPanel();
 assert.equal((panel.match(/data-resize-edge=/g)||[]).length,8);assert.match(panel,/data-action="reset-panel-size"/);
});


test('resize directions preserve opposite anchors and clean up every edge',async()=>{
 for(const edge of ['n','s','e','w','ne','nw','se','sw']){
  const l=loadContent(),{handle}=resizeFixture(l,'bar',edge);
  const x=edge.includes('w')?100:500,y=edge.includes('n')?100:500;
  const before=JSON.stringify(l.api.runtime.state);handle.emit('pointerdown',resizeEvent(x,y));
  l.windowListeners.get('pointermove')(resizeEvent(x+(edge.includes('w')?-20:20),y+(edge.includes('n')?-20:20)));
  const scale=l.api.runtime.settings.barScale,pos=l.api.runtime.settings.barPosition;
  assert.ok(scale>1&&scale<=1.5,edge);
  if(edge.includes('w'))assert.ok(Math.abs(pos.x+400*scale-500)<1,edge);else assert.equal(pos.x,100);
  if(edge.includes('n'))assert.ok(Math.abs(pos.y+400*scale-500)<1,edge);else assert.equal(pos.y,100);
  await l.windowListeners.get('pointerup')(resizeEvent());assert.equal(l.calls.patches.length,1);assert.equal(JSON.stringify(l.api.runtime.state),before);
 }
});
test('resized panel movement persists visual coordinates independently of zoom',async()=>{
 const l=loadContent();l.api.runtime.settings.panelScale=1.5;
 const handle=eventElement(),element=eventElement();element.style={};element.getBoundingClientRect=()=>({left:100,top:100,width:400,height:400});
 l.shadowSingles.set('[data-drag-handle]',handle);l.shadowSingles.set('.tango-panel',element);
 l.api.bindDraggable('[data-drag-handle]','.tango-panel','panelPosition');
 handle.emit('pointerdown',{...resizeEvent(100,100),target:{closest:()=>null}});
 l.windowListeners.get('pointermove')(resizeEvent(160,130));await l.windowListeners.get('pointerup')(resizeEvent());
 assert.equal(l.api.runtime.settings.panelPosition.x,160);assert.equal(element.style.left,`${160/1.5}px`);assert.equal(element.style.top,`${130/1.5}px`);
});
test('resize freezes markup replacement, releases on route change and ignores non-owner pointers',()=>{
 const l=loadContent(),{handle}=resizeFixture(l);
 handle.emit('pointerdown',resizeEvent(500,500,{pointerId:8}));
 const before=l.api.runtime.settings.panelScale;
 l.windowListeners.get('pointermove')(resizeEvent(580,500,{pointerId:9}));assert.equal(l.api.runtime.settings.panelScale,before);
 const markup=l.api.runtime.renderedMarkup;l.api.render();assert.equal(l.api.runtime.renderedMarkup,markup);
 l.context.location.href='https://gmgn.ai/?chain=sol';l.api.handleRouteChange();assert.equal(l.api.runtime.floatingGesture,false);
 assert.equal(l.windowListeners.has('pointermove'),false);assert.equal(l.calls.patches.length,0);
});
test('no-op resize and master-off cancellation do not persist a size or submit a trade',async()=>{
 const l=loadContent(),{handle}=resizeFixture(l);
 handle.emit('pointerdown',resizeEvent());await l.windowListeners.get('pointerup')(resizeEvent());assert.equal(l.calls.patches.length,0);
 handle.emit('pointerdown',resizeEvent());l.windowListeners.get('pointermove')(resizeEvent(520,500));
 l.api.runtime.settings.enabled=false;l.api.render();assert.equal(l.api.runtime.floatingGesture,false);assert.equal(l.windowListeners.has('pointermove'),false);
 assert.equal(l.calls.patches.length,0);assert.equal(l.calls.buyOrders.length+l.calls.sellOrders.length,0);
});


test('resize release click cannot leak to trade controls after the widget is rebuilt',async()=>{
 const timers=[];const l=loadContent({timer:(callback)=>{timers.push(callback);return timers.length;}}),{handle}=resizeFixture(l);
 handle.emit('pointerdown',resizeEvent());l.windowListeners.get('pointermove')(resizeEvent(580,500));
 await l.windowListeners.get('pointerup')(resizeEvent());
 let prevented=0,stopped=0;l.windowListeners.get('click')({preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}});
 assert.equal(prevented,1);assert.equal(stopped,1);
 timers.forEach(fn=>fn());assert.equal(l.windowListeners.has('click'),false);
 assert.equal(l.calls.buyOrders.length+l.calls.sellOrders.length,0);
});


test('extension reload during resize cancels the gesture without attempting settings writes',async()=>{
 const l=loadContent({sendMessage:()=>{throw new Error('Extension context invalidated.');}}),{handle}=resizeFixture(l);
 handle.emit('pointerdown',resizeEvent());l.windowListeners.get('pointermove')(resizeEvent(580,500));
 l.api.ensureNativePrice(null);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(l.api.runtime.extensionInvalidated,true);assert.equal(l.api.runtime.floatingGesture,false);
 assert.equal(l.windowListeners.has('pointermove'),false);assert.equal(l.windowListeners.has('click'),false);assert.equal(l.calls.patches.length,0);
});

function combinedContentTest() {
  const loaded=loadContent({href:'https://gmgn.ai/'});
  loaded.context.Tango.GMGN._isCombinedTrenchPage=()=>!new URL(loaded.context.location.href).searchParams.has('chain');
  loaded.context.Tango.GMGN._isTrenchPage=()=>true;
  loaded.api.runtime.settings.fastMode=true;
  loaded.api.runtime.settings.confirmationEnabled=false;
  loaded.api.rememberNativePrice('sol',100,loaded.clock.now);
  loaded.api.rememberNativePrice('bsc',500,loaded.clock.now);
  return loaded;
}
function mixedBuyContext(loaded) {
  return {token:{chain:'bsc',address:ADDRESS_A,symbol:'MIX',metadataVerified:true,metadataSource:'GMGN_TRENCH'},
    quote:{chain:'bsc',address:ADDRESS_A,priceUsd:2,marketCapUsd:2000,nativePriceUsd:500,
      observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},
    amountNative:.5,amountChain:'bsc',validate:()=>true};
}
test('combined quick buy uses the target native amount without affecting the viewed account',async()=>{
  const loaded=combinedContentTest();
  await loaded.api.handleQuickBuy(mixedBuyContext(loaded));
  assert.equal(loaded.calls.buy,1);
  assert.equal(loaded.calls.buyOrders[0].token.chain,'bsc');
  assert.equal(loaded.calls.buyOrders[0].amountNative,.5);
});
test('combined confirmation survives quote renders and displays the target currency',async()=>{
  const loaded=combinedContentTest();
  loaded.api.runtime.settings.fastMode=false;
  loaded.api.runtime.settings.confirmationEnabled=true;
  await loaded.api.handleQuickBuy(mixedBuyContext(loaded));
  assert.equal(loaded.calls.buy,0);
  assert.equal(loaded.api.runtime.modal?.type,'confirm');
  loaded.api.render();
  assert.equal(loaded.api.runtime.modal?.type,'confirm');
  assert.match(loaded.shell.innerHTML,/BNB/);
  await loaded.api.runtime.modal.action();
  assert.equal(loaded.calls.buy,1);
});
test('combined confirmation refuses stale card bindings',async()=>{
  const loaded=combinedContentTest();
  loaded.api.runtime.settings.fastMode=false;
  loaded.api.runtime.settings.confirmationEnabled=true;
  let valid=true;
  await loaded.api.handleQuickBuy({...mixedBuyContext(loaded),validate:()=>valid});
  assert.equal(loaded.api.runtime.modal?.type,'confirm');
  valid=false;
  await loaded.api.runtime.modal.action();
  assert.equal(loaded.calls.buy,0);

});
test('combined rendering and quote ticks preserve list replacements',async()=>{
  const loaded=combinedContentTest();
  loaded.api.syncQuickBuyButtons();
  assert.equal(loaded.calls.discoverTokenCards,1);
  const clears=loaded.calls.clearQuickBuy;
  loaded.api.render();
  await loaded.api.performQuoteTick();
  assert.equal(loaded.calls.clearQuickBuy,clears);
});

test('combined native preset mode rejects a foreign input currency without converting it',async()=>{
  const loaded=combinedContentTest();
  await loaded.api.handleQuickBuy({...mixedBuyContext(loaded),amountChain:'sol'});
  assert.equal(loaded.calls.buy,0);
});
test('combined account windows reuse the most recent single-chain account with a visible chain label',()=>{
  const loaded=combinedContentTest();
  loaded.api.runtime.activeChainId='base';
  loaded.api.render();
  assert.match(loaded.shell.innerHTML,/BASE/);
  assert.match(loaded.shell.innerHTML,/10 ETH|0 ETH/);
  assert.equal(loaded.api.runtime.activeChainId,'base');
});

test('combined six-chain buy and partial sell use the real ledger without touching unrelated accounts',async()=>{
  for(const chain of Chains.all()){
    const loaded=combinedContentTest();
    loaded.api.runtime.state=RealState.createInitialState({now:loaded.clock.now,initialBalances:Object.fromEntries(Chains.all().map(c=>[c.id,10]))});
    loaded.api.runtime.state.initialized=true;
    loaded.api.runtime.settings=RealState.normalizeSettings({
      fastMode:true,confirmationEnabled:false,slippageBps:0,platformFeeBps:0,
      chains:Object.fromEntries(Chains.all().map(c=>[c.id,{networkFeeNative:0}]))
    });
    const sentinelChain=chain.id==='bsc'?'sol':'bsc';
    const sentinelAddress=sentinelChain==='sol'?'So11111111111111111111111111111111111111112':ADDRESS_B;
    const sentinel=RealEngine.executeBuy(loaded.api.runtime.state,{
      token:{chain:sentinelChain,address:sentinelAddress,symbol:'KEEP',metadataVerified:true,metadataSource:'GMGN_NETWORK'},
      quote:{chain:sentinelChain,address:sentinelAddress,priceUsd:2,marketCapUsd:2000,nativePriceUsd:100,
        observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},
      amountNative:.2},loaded.api.runtime.settings,loaded.clock.now);
    loaded.api.runtime.state=sentinel.state;
    loaded.api.runtime.activeChainId=sentinelChain;
    const address=chain.id==='sol'?'So11111111111111111111111111111111111111112':ADDRESS_A;
    loaded.api.rememberNativePrice(chain.id,100,loaded.clock.now);
    const before=structuredClone(loaded.api.runtime.state);
    loaded.context.Tango.Store.executeBuy=async order=>RealEngine.executeBuy(loaded.api.runtime.state,order,loaded.api.runtime.settings,loaded.clock.now);
    loaded.context.Tango.Store.executeSell=async order=>RealEngine.executeSell(loaded.api.runtime.state,order,loaded.api.runtime.settings,loaded.clock.now);
    const context={token:{chain:chain.id,address,symbol:'MIX',metadataVerified:true,metadataSource:'GMGN_TRENCH'},
      quote:{chain:chain.id,address,priceUsd:2,marketCapUsd:2000,nativePriceUsd:100,
        observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},
      amountNative:.1,amountChain:chain.id,validate:()=>true};
    await loaded.api.handleQuickBuy(context);
    let state=loaded.api.runtime.state;
    const position=state.positions[RealEngine.positionKey(chain.id,address)];
    assert.ok(position,chain.id+' buy must reach the real ledger');
    assert.ok(Math.abs(state.accounts[chain.id].cashBalanceNative-9.9)<1e-10);
    const initialQuantity=position.quantity;
    await loaded.api.handleQuickBuy({...context,side:'SELL',sellPercent:25});
    state=loaded.api.runtime.state;
    assert.ok(Math.abs(state.positions[RealEngine.positionKey(chain.id,address)].quantity-initialQuantity*.75)<1e-10);
    assert.ok(Math.abs(state.accounts[chain.id].cashBalanceNative-9.925)<1e-10);
    assert.ok(Math.abs(state.accounts[chain.id].realizedPnlNative)<1e-10);
    for(const other of Chains.all().filter(c=>c.id!==chain.id)){
      assert.deepEqual(state.accounts[other.id],before.accounts[other.id],other.id+' account is unchanged');
    }
    assert.equal(state.trades.length,3);
    assert.equal(state.trades.slice(0,2).every(t=>t.chain===chain.id),true);
    assert.deepEqual(state.positions[RealEngine.positionKey(sentinelChain,sentinelAddress)],before.positions[RealEngine.positionKey(sentinelChain,sentinelAddress)],'original position and cost remain unchanged');
    assert.deepEqual(state.trades.find(t=>t.id===before.trades[0].id),before.trades[0],'original history remains unchanged');
    assert.equal(loaded.api.runtime.activeChainId,sentinelChain,'foreign card orders do not switch viewed account');
  }
});

test('combined first startup honors the persisted selected account instead of freezing the SOL fallback',async()=>{
  const settings={...defaultSettings(),selectedChain:'bsc'};
  const loaded=loadContent({href:'https://gmgn.ai/',getAll:()=>({state:defaultState(),settings}),timer:()=>0});
  loaded.api.runtime.settings=null;
  loaded.api.runtime.activeChainId=null;
  loaded.context.Tango.GMGN._isCombinedTrenchPage=()=>true;
  loaded.context.Tango.GMGN._isTrenchPage=()=>true;
  await loaded.api.start();
  loaded.api.render();
  assert.match(loaded.shell.innerHTML,/BSC/);
  assert.doesNotMatch(loaded.shell.innerHTML,/todayPnl · SOL/);
});

test('combined delayed SPA controls retain the prior BSC account despite a different selected account',()=>{
  const loaded=loadContent({href:'https://gmgn.ai/?chain=bsc'});
  loaded.api.runtime.settings.selectedChain='sol';
  let ready=false;
  loaded.context.Tango.GMGN._isCombinedTrenchPage=()=>ready;
  loaded.context.location.href='https://gmgn.ai/';
  loaded.api.handleRouteChange();
  ready=true;
  loaded.api.render();
  assert.match(loaded.shell.innerHTML,/BSC/);
  assert.doesNotMatch(loaded.shell.innerHTML,/todayPnl · SOL/);
});

test('combined controls mounting at the same URL release route-gated quick buys',async()=>{
  const loaded=combinedContentTest();
  loaded.api.runtime.routeIdentity='unsupported:https://gmgn.ai/';
  loaded.api.handleRouteChange();
  await loaded.api.handleQuickBuy(mixedBuyContext(loaded));
  assert.equal(loaded.calls.buy,1,'same-URL combined readiness must release quick buy');
  const epoch=loaded.api.runtime.routeEpoch;
  loaded.api.handleRouteChange();
  assert.equal(loaded.api.runtime.routeEpoch,epoch,'stable readiness must not repeatedly invalidate actions');
});

test('late combined controls reconcile route identity in the mounting observer',async()=>{
  let observer;
  const loaded=loadContent({href:'https://gmgn.ai/',timer:()=>0,MutationObserver:class{constructor(callback){observer=callback;}observe(){}disconnect(){}}});
  let ready=false;
  loaded.context.Tango.GMGN._isCombinedTrenchPage=()=>ready;
  await loaded.api.start();
  assert.equal(loaded.api.runtime.routeIdentity,'unsupported:https://gmgn.ai/');
  ready=true;
  observer([]);
  assert.equal(loaded.api.runtime.routeIdentity,'combined:https://gmgn.ai/');
});


for (const mode of ['open','navigate','none']) test(`successful list buy follows GMGN after-buy mode: ${mode}`, async()=>{
 const loaded=loadContent({href:'https://gmgn.ai/?chain=eth'});
 loaded.api.runtime.settings.fastMode=true; loaded.api.runtime.settings.confirmationEnabled=false;
 loaded.api.rememberNativePrice('eth',3000,loaded.clock.now);
 loaded.context.Tango.GMGN.readAfterBuyDetailMode=()=>mode;
 const navigations=[]; loaded.context.location.assign=url=>navigations.push(url);
 await loaded.api.handleQuickBuy({token:{chain:'eth',address:ADDRESS_A,symbol:'TEST'}, quote:{priceUsd:2,marketCapUsd:2000,nativePriceUsd:3000,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},amountNative:.1});
 assert.equal(loaded.calls.buy,1);
 assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length, mode==='open'?1:0);
 assert.equal(navigations.length,mode==='navigate'?1:0);
});

test('failed, cancelled and detail-panel buys never open post-buy tabs',async()=>{
 const loaded=loadContent({href:'https://gmgn.ai/?chain=eth'});
 loaded.api.runtime.settings.fastMode=true; loaded.api.runtime.settings.confirmationEnabled=false;
 loaded.api.rememberNativePrice('eth',3000,loaded.clock.now);
 loaded.context.Tango.GMGN.readAfterBuyDetailMode=()=> 'open';
 const order={token:{chain:'eth',address:ADDRESS_A,symbol:'TEST'},quote:{priceUsd:2,marketCapUsd:2000,nativePriceUsd:3000,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},amountNative:.1};
 loaded.context.Tango.Store.executeBuy=async()=>{throw new Error('invalidQuote')};
 await loaded.api.handleQuickBuy(order);
 assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length,0);
 loaded.context.Tango.Store.executeBuy=async()=>({state:loaded.api.runtime.state});
 await loaded.api.buy(.1,order);
 assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length,0,'detail presets do not inherit list navigation');
 loaded.api.runtime.settings.fastMode=false;loaded.api.runtime.settings.confirmationEnabled=true;
 await loaded.api.handleQuickBuy(order);
 assert.equal(loaded.api.runtime.modal.type,'confirm');
 assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length,0,'preview does not navigate');
});


test('post-buy preference persists separately per chain and ignores stale initial storage reads',async()=>{
 const loaded=loadContent({href:'https://gmgn.ai/?chain=eth'});let mode='open';const writes=[];const gate=deferred();
 loaded.context.chrome.storage.local={get:()=>gate.promise,set:value=>{writes.push(value);return Promise.resolve()}};
 loaded.context.Tango.GMGN.readAfterBuyDetailMode=()=>mode;
 const load=loaded.api.loadAfterBuyDetailPreference();
 assert.equal(loaded.api.synchronizeAfterBuyDetailPreference(),'open');
 gate.resolve({'tangoGmgnAfterBuyDetailV1:eth':'none'});await load;
 assert.equal(loaded.api.runtime.afterBuyDetailModes.eth,'open');
 mode=null;loaded.context.location.href='https://gmgn.ai/?chain=bsc';
 assert.equal(loaded.api.synchronizeAfterBuyDetailPreference(),null,'unseen chain cannot inherit another chain');
 mode='none';loaded.api.synchronizeAfterBuyDetailPreference();
 assert.equal(loaded.api.runtime.afterBuyDetailModes.eth,'open');assert.equal(loaded.api.runtime.afterBuyDetailModes.bsc,'none');
 assert.equal(writes.length,2);
 loaded.dispatchStorageChange({'tangoGmgnAfterBuyDetailV1:bsc':{newValue:'navigate'}});
 mode=null;assert.equal(loaded.api.synchronizeAfterBuyDetailPreference(),'navigate');
 loaded.dispatchStorageChange({'tangoGmgnAfterBuyDetailV1:bsc':{newValue:'corrupted'}});
 assert.equal(loaded.api.synchronizeAfterBuyDetailPreference(),null);
});

test('confirmed list buy opens once after settlement and tab failure preserves successful ledger',async()=>{
 const loaded=loadContent({href:'https://gmgn.ai/?chain=eth',sendMessage:async message=>message.type==='TANGO_OPEN_TOKEN'?{ok:false,error:'Browser blocked tab'}:{ok:true}});
 loaded.api.rememberNativePrice('eth',3000,loaded.clock.now);loaded.context.Tango.GMGN.readAfterBuyDetailMode=()=> 'open';
 const context={token:{chain:'eth',address:ADDRESS_A,symbol:'TEST'},quote:{priceUsd:2,marketCapUsd:2000,nativePriceUsd:3000,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},amountNative:.1};
 await loaded.api.handleQuickBuy(context);
 assert.equal(loaded.calls.buy,0);assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length,0);
 await loaded.api.runtime.modal.action();await Promise.resolve();
 assert.equal(loaded.calls.buy,1);assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length,1);
 assert.equal(loaded.api.runtime.tradePending,false);assert.equal(loaded.api.runtime.modal,null);
 assert.ok(!String(loaded.api.runtime.toast?.message).includes('buyFailed'));
});

test('route changes during settlement suppress after-buy navigation',async()=>{
 const loaded=loadContent({href:'https://gmgn.ai/?chain=eth'});const gate=deferred();
 loaded.api.runtime.settings.fastMode=true;loaded.api.runtime.settings.confirmationEnabled=false;
 loaded.api.rememberNativePrice('eth',3000,loaded.clock.now);loaded.context.Tango.GMGN.readAfterBuyDetailMode=()=> 'open';
 loaded.context.Tango.Store.executeBuy=()=>gate.promise;
 const action=loaded.api.handleQuickBuy({token:{chain:'eth',address:ADDRESS_A,symbol:'TEST'},quote:{priceUsd:2,marketCapUsd:2000,nativePriceUsd:3000,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},amountNative:.1});
 loaded.context.location.href='https://gmgn.ai/?chain=bsc';
 gate.resolve({state:loaded.api.runtime.state});await action;
 assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length,0);assert.equal(loaded.api.runtime.tradePending,false);
});


test('settled list buy still follows preference while real store notifications refresh the account',async()=>{
 const gate=deferred();const loaded=loadContent({href:'https://gmgn.ai/?chain=eth',getAll:()=>gate.promise});let refreshing;
 loaded.api.runtime.settings.fastMode=true;loaded.api.runtime.settings.confirmationEnabled=false;
 loaded.api.rememberNativePrice('eth',3000,loaded.clock.now);loaded.context.Tango.GMGN.readAfterBuyDetailMode=()=> 'open';
 loaded.context.Tango.Store.executeBuy=async()=>{refreshing=loaded.api.performRefresh();return {state:loaded.api.runtime.state}};
 await loaded.api.handleQuickBuy({token:{chain:'eth',address:ADDRESS_A,symbol:'TEST'},quote:{priceUsd:2,marketCapUsd:2000,nativePriceUsd:3000,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},amountNative:.1});
 assert.equal(loaded.api.runtime.quickBuySettingsPending,true,'account refresh is still awaiting its response');
 const opens=loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length;
 gate.resolve({state:loaded.api.runtime.state,settings:loaded.api.runtime.settings});await refreshing;
 assert.equal(opens,1,'a transient account refresh cannot cancel post-settlement navigation');
});

test('authoritative master disable still suppresses navigation after settlement',async()=>{
 const loaded=loadContent({href:'https://gmgn.ai/?chain=eth'});
 loaded.api.runtime.settings.fastMode=true;loaded.api.runtime.settings.confirmationEnabled=false;
 loaded.api.rememberNativePrice('eth',3000,loaded.clock.now);loaded.context.Tango.GMGN.readAfterBuyDetailMode=()=> 'open';
 loaded.context.Tango.Store.executeBuy=async()=>{loaded.api.runtime.quickBuyAuthoritativelyDisabled=true;return {state:loaded.api.runtime.state}};
 await loaded.api.handleQuickBuy({token:{chain:'eth',address:ADDRESS_A,symbol:'TEST'},quote:{priceUsd:2,marketCapUsd:2000,nativePriceUsd:3000,observedAt:loaded.clock.now,nativePriceObservedAt:loaded.clock.now,source:'GMGN_NETWORK'},amountNative:.1});
 assert.equal(loaded.messages.filter(m=>m.type==='TANGO_OPEN_TOKEN').length,0);
});


test('rejected sell requests fresh quotes without retrying or changing the position', async () => {
 const loaded=loadContent();seedHeldDetailPosition(loaded);
 const before=JSON.stringify(loaded.api.runtime.state);
 loaded.api.runtime.current.quote={...detailQuote(4300,loaded.clock.now),priceUsd:.000043,totalSupply:1e9,supplySource:'GMGN_EXACT'};
 loaded.api.runtime.gmgnQuotes.clear();
 await loaded.api.sell(100);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(loaded.calls.sell,0);assert.equal(JSON.stringify(loaded.api.runtime.state),before);
 assert.ok(loaded.messages.some(m=>m.type==='TANGO_GET_TOKEN_QUOTE'),'failed sell must start background quote recovery');
 const diagnostic=JSON.parse(loaded.host.getAttribute('data-tango-sell-rejection'));
 assert.equal(diagnostic.stage,'sell-preview:invalidQuote');assert.equal(diagnostic.address,ADDRESS_A);
 loaded.api.resolvePaperTradeQuote({chain:'eth',address:ADDRESS_B},{...detailQuote(4300,loaded.clock.now,ADDRESS_B),priceUsd:.000043,totalSupply:1e9,supplySource:'GMGN_EXACT'});
 assert.equal(loaded.host.getAttribute('data-tango-sell-rejection'),JSON.stringify(diagnostic),'other cards cannot replace sell failure evidence');
});


test('quote recovery never sells automatically when a coherent detail quote arrives', async () => {
 let snapshot=null;const loaded=loadContent({readVerifiedCurrentTokenSnapshot:()=>snapshot});seedHeldDetailPosition(loaded);
 loaded.api.runtime.gmgnQuotes.clear();
 loaded.api.runtime.current.quote={...detailQuote(4000,loaded.clock.now),priceUsd:.00004,totalSupply:1e9,supplySource:'GMGN_EXACT'};
 await loaded.api.sell(100);await new Promise(resolve=>setImmediate(resolve));assert.equal(loaded.calls.sell,0);
 snapshot={token:loaded.api.runtime.current.token,quote:{...detailQuote(4000,loaded.clock.now),totalSupply:1e9,supplySource:'GMGN_EXACT'}};
 await new Promise(resolve=>setImmediate(resolve));assert.equal(loaded.calls.sell,0);
 await loaded.api.sell(100);assert.equal(loaded.calls.sell,1);assert.equal(loaded.calls.sellOrders[0].quote.priceUsd,.000004);
});

test('a rejected sell confirmation refreshes quotes but never commits the conflicting price', async () => {
 let snapshot=null;const loaded=loadContent({readVerifiedCurrentTokenSnapshot:()=>snapshot});seedHeldDetailPosition(loaded);loaded.api.runtime.settings.confirmationEnabled=true;
 await loaded.api.sell(25);const confirm=loaded.api.runtime.modal.action;
 await new Promise(resolve=>setImmediate(resolve));loaded.messages.length=0;
 loaded.api.runtime.gmgnQuotes.clear();loaded.api.runtime.quoteRequests.clear();loaded.api.runtime.quoteRetryAt.clear();
 loaded.api.runtime.current.quote={...detailQuote(4000,loaded.clock.now),priceUsd:.00004,totalSupply:1e9,supplySource:'GMGN_EXACT'};
 // The order itself becomes a mixed observation while its confirmation is open.
 const conflict=loaded.api.runtime.current.quote;
 snapshot={token:loaded.api.runtime.current.token,quote:conflict};
 loaded.api.runtime.gmgnQuotes.set('eth:'+ADDRESS_A,conflict);
 const before=JSON.stringify(loaded.api.runtime.state);await confirm();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(loaded.calls.sell,0);assert.equal(JSON.stringify(loaded.api.runtime.state),before);
 assert.ok(loaded.messages.some(m=>m.type==='TANGO_GET_TOKEN_QUOTE'));
 assert.equal(JSON.parse(loaded.host.getAttribute('data-tango-sell-rejection')).stage,'sell-commit:invalidQuote');
});

test('missing-position and disabled sells do not start quote recovery', async () => {
 const loaded=loadContent();loaded.api.runtime.current=quoteContext();await loaded.api.sell(100);
 loaded.api.runtime.settings.enabled=false;await loaded.api.sell(100);
 assert.equal(loaded.calls.sell,0);assert.equal(loaded.messages.length,0);assert.equal(loaded.host.getAttribute('data-tango-sell-rejection'),null);
});

test('note backup text never appears in the GMGN open shadow markup', () => {
 const loaded=loadContent();loaded.api.runtime.modal={type:'dashboard-error',title:'Backup',note:'Blocked',backupJson:'{"reviewNotes":{"text":"PRIVATE_JOURNAL_TEST"}}'};
 const html=loaded.api.renderModal();assert.ok(html.includes('tango-backup-json-fallback'));assert.ok(!html.includes('PRIVATE_JOURNAL_TEST'),'full backup belongs in a closed shadow field');
});

test('review entry stays near the title and uses independent journal UI without trading',async()=>{
 const loaded=loadContent();seedHeldDetailPosition(loaded);const seen={refresh:0,editor:[],daily:0};let recorded=true;
 loaded.context.Tango.Store.getReviewNotes=async()=>({});
 loaded.context.Tango.ReviewJournal={create:()=>({refresh:()=>{seen.refresh++;return Promise.resolve();},status:()=>recorded,setEnabled(){},openEditor:async token=>seen.editor.push(token),openDaily:async()=>{seen.daily++;}})};
 for(let i=0;i<10;i++){const html=loaded.api.renderPanel();assert.ok(html.indexOf('data-action="token-review"')>html.indexOf('tango-trade-body'));assert.ok(html.indexOf('data-action="token-review"')<html.indexOf('data-buy='));assert.match(html,/class="tango-buy-account"/);assert.match(html,/Recorded/);assert.match(html,/data-buy=/);assert.match(html,/data-sell=/);assert.match(html,/data-action="trade-replay"/);}
 assert.equal(seen.refresh,1,'quote rerenders must not reload all notes');
 assert.match(loaded.api.renderPanel(),/class="tango-review-entry-icon" aria-hidden="true"/);
 recorded=false;assert.match(loaded.api.renderPanel(),/Write review/);recorded=true;
 const editor=eventElement({dataset:{action:'token-review'}}),daily=eventElement({dataset:{action:'daily-review'}});loaded.shellLists.set('[data-action]',[editor,daily]);loaded.api.bindEvents();
 await editor.emit('click',{isTrusted:true,stopPropagation(){}});await daily.emit('click',{isTrusted:true,stopPropagation(){}});
 assert.equal(seen.editor[0].address,ADDRESS_A);assert.equal(seen.daily,1);assert.equal(loaded.calls.buy,0);assert.equal(loaded.calls.sell,0);
 loaded.api.runtime.calendarOpen=true;const calendar=loaded.api.renderPnlCalendar();assert.match(calendar,/data-action="daily-review"/);assert.match(calendar,/data-action="daily-report"/);assert.match(calendar,/data-action="dashboard-history"/);
});
