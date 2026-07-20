const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

global.Tango = {};
const Chains = require('../src/core/chains.js');
const contentSource = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
const START = "  start().catch((error) => console.error('[Tango Paper Trader]', error));";
const EXPOSE = `  global.__contentTest = {
    runtime, performQuoteTick, handleRouteChange, handleQuickBuy, buy,
    ensureTokenQuote, ensureNativePrice, freshNativePrice, rememberNativePrice,
    requireExecutableQuote, freshExecutableQuote, renderPanel, renderBar, renderDrawer, requestCloseAll,
    commitCloseAll, savePresetEdits, bindEvents, bindDraggable
  };`;
const instrumentedSource = contentSource.replace(START, EXPOSE);

const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function defaultState() {
  return {
    initialized: true,
    accounts: {
      eth: { cashBalanceNative: 10 }, base: { cashBalanceNative: 10 }, sol: { cashBalanceNative: 10 },
      bsc: { cashBalanceNative: 10 }, robinhood: { cashBalanceNative: 10 }, xlayer: { cashBalanceNative: 10 }
    },
    positions: {}, trades: [], dailyRealizedByChain: { eth: {}, base: {} }
  };
}

function defaultSettings() {
  const chain = { buyPresets: [1], networkFeeNative: 0 };
  return {
    enabled: true, showListQuickBuy: true, language: 'en', displayCurrency: 'NATIVE', fastMode: false,
    confirmationEnabled: true, platformFeeBps: 0, slippageBps: 0, soundEnabled: false,
    barCollapsed: false, panelCollapsed: false, panelPosition: null,
    chains: { eth: { ...chain }, base: { ...chain }, sol: { ...chain } }, sellPresets: [100]
  };
}

function mergeSettingsPatch(settings, patch) {
  const chains = { ...settings.chains };
  Object.entries(patch.chains || {}).forEach(([chainId, chainPatch]) => {
    chains[chainId] = { ...chains[chainId], ...chainPatch };
  });
  return { ...settings, ...patch, chains };
}

function loadContent({ href = `https://gmgn.ai/eth/token/${ADDRESS_A}`, readCurrentToken, sendMessage, patchSettings } = {}) {
  assert.notEqual(instrumentedSource, contentSource, 'content test harness must replace startup with runtime exports');
  const messages = [];
  const calls = { buy: 0, buyOrders: [], patches: [], fullSaves: [], getAll: 0, chainUsdSummaries: [] };
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
  const genericElement = () => ({
    className: '', id: '', rel: '', href: '', style: {}, dataset: {}, innerHTML: '', textContent: '',
    append() {}, appendChild() {}, addEventListener() {}, remove() {}, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  });
  let createCount = 0;
  const document = {
    body: genericElement(), head: genericElement(),
    documentElement: { appendChild() {} },
    createElement() { createCount += 1; return createCount === 1 ? host : createCount === 3 ? shell : genericElement(); },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}
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
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    postMessage() {},
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type, listener) { if (windowListeners.get(type) === listener) windowListeners.delete(type); },
    MutationObserver: class { observe() {} },
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
    I18n: { resolveLanguage: () => 'en', t: (key) => key },
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
      getAll: async () => { calls.getAll += 1; return { state: defaultState(), settings: defaultSettings() }; },
      async patchSettings(patch) {
        calls.patches.push(patch);
        if (patchSettings) return patchSettings(patch);
        return mergeSettingsPatch(context.__contentTest.runtime.settings, patch);
      },
      async saveSettings(settings) {
        calls.fullSaves.push(settings);
        throw new Error('content must use patchSettings');
      },
      async executeBuy(order) { return context.Tango.Engine.executeBuy(defaultState(), order); },
      async executeSell(order) { return context.Tango.Engine.executeSell(defaultState(), order); },
      async executeCloseAll(chain, orders) { return context.Tango.Engine.executeCloseAll(defaultState(), chain, orders); },
      async updatePositionQuote() { return defaultState(); },
      async updatePositionMetadata() { return defaultState(); },
      async updatePositionMetadataBatch() { return defaultState(); },
      subscribe() {}
    },
    Engine: {
      positionKey: (chain, address) => `${chain}:${String(address).toLowerCase()}`,
      validateQuote(quote, now, staleMs, context) {
        const hasValue = Number(quote?.priceUsd || quote?.marketCapUsd) > 0;
        const observedAt = quote?.observedAt;
        const nativePriceObservedAt = quote?.nativePriceObservedAt;
        const validTimestamps = typeof observedAt === 'number' && Number.isSafeInteger(observedAt) && observedAt > 0
          && typeof nativePriceObservedAt === 'number'
          && Number.isSafeInteger(nativePriceObservedAt) && nativePriceObservedAt > 0
          && observedAt - FakeDate.now() <= 5_000
          && nativePriceObservedAt - FakeDate.now() <= 5_000;
        const fresh = validTimestamps && FakeDate.now() - observedAt <= 15_000
          && FakeDate.now() - nativePriceObservedAt <= 15_000;
        const marketCapAllowed = quote?.valuationMode !== 'MARKET_CAP' || Number(quote?.priceUsd || 0) > 0
          || context?.marketCapProvenance === 'SOLANA_PUMP_TRENCH_V1';
        if (!validTimestamps || !hasValue || !marketCapAllowed || !(Number(quote?.nativePriceUsd) > 0)) {
          return { ok: false, reason: 'invalidQuote' };
        }
        return fresh ? { ok: true } : { ok: false, reason: 'staleQuote' };
      },
      updatePositionMetadata: (state) => state,
      updatePositionQuote: (state) => state,
      executeBuy(state, order) { calls.buy += 1; calls.buyOrders.push(order); return { state, trade: {} }; },
      executeSell: (state) => ({ state, trade: {} }), executeCloseAll: (state) => ({ state, trades: [], failures: [] }),
      markPosition(position, quote) {
        const priceUsd = quote
          ? Number(quote.priceUsd || 0)
          : Number(position?.lastPriceUsd || position?.averageEntryPriceUsd || 0);
        const nativePriceUsd = Number(quote?.nativePriceUsd || position?.lastNativePriceUsd || 0);
        const valueNative = priceUsd > 0 && nativePriceUsd > 0
          ? Number(position?.quantity || 0) * priceUsd / nativePriceUsd
          : Number(position?.costBasisNative || 0);
        const unrealizedPnlNative = valueNative - Number(position?.costBasisNative || 0);
        const roi = Number(position?.costBasisNative || 0) > 0
          ? unrealizedPnlNative / Number(position.costBasisNative) * 100
          : 0;
        return { priceUsd, nativePriceUsd, valueNative, unrealizedPnlNative, roi };
      },
      portfolioSummary(state, chain) {
        const account = state.accounts[chain];
        const positions = Object.values(state.positions || {}).filter((position) => position.chain === chain);
        const positionsValueNative = positions.reduce((sum, position) => sum + context.Tango.Engine.markPosition(position).valueNative, 0);
        const equityNative = Number(account.cashBalanceNative) + positionsValueNative;
        return {
          cashBalanceNative: Number(account.cashBalanceNative), positionsValueNative, equityNative,
          totalPnlNative: equityNative - Number(account.initialBalanceNative || 0), positionCount: positions.length
        };
      },
      chainUsdSummary(state, chain, nativePriceUsd) {
        if (!(Number(nativePriceUsd) > 0)) throw new Error('invalidNativePrice');
        calls.chainUsdSummaries.push({ state, chain, nativePriceUsd });
        const account = state.accounts[chain];
        const positionsUsd = Object.values(state.positions || {})
          .filter((position) => position.chain === chain)
          .reduce((sum, position) => sum + Number(position.quantity || 0)
            * context.Tango.Engine.markPosition(position).priceUsd, 0);
        const cashUsd = Number(account.cashBalanceNative) * Number(nativePriceUsd);
        const principalUsd = Number(account.initialBalanceNative) * Number(nativePriceUsd);
        const assetsUsd = cashUsd + positionsUsd;
        return { cashUsd, positionsUsd, principalUsd, assetsUsd, pnlUsd: assetsUsd - principalUsd };
      },
      breakevenSellPercent: () => null
    },
    GMGN: {
      clearQuickBuy() {}, discoverTokenCards: () => 0, readVisibleTokenMetadata: () => [],
      readCurrentToken: readCurrentToken || (async () => null),
      resolveCurrentTokenRead(previous, next, url = context.location.href) {
        if (next) return next;
        const parsed = new URL(url);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const routeAddress = parts[1] === 'token' ? parts[2]?.toLowerCase() : '';
        return previous?.token?.chain === parts[0] && previous.token.address.toLowerCase() === routeAddress ? previous : null;
      },
      needsCurrentTokenRead: () => false
    }
  };
  vm.runInNewContext(instrumentedSource, context, { filename: 'src/content/content.js' });
  const api = context.__contentTest;
  api.runtime.state = defaultState();
  api.runtime.settings = defaultSettings();
  api.runtime.activeChainId = Chains.fromUrl(href)?.id || null;
  return { api, calls, clock, context, messages, shadowLists, shadowSingles, shellLists, windowListeners };
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
  const summary = loaded.context.Tango.Engine.portfolioSummary(loaded.api.runtime.state, 'eth');

  const bar = loaded.api.renderBar(summary);
  const drawer = loaded.api.renderDrawer(summary);
  loaded.api.requestCloseAll();

  assert.match(bar, /0 ETH/);
  assert.doesNotMatch(bar, /\$/);
  assert.match(drawer, /positionTotal[\s\S]*1 ETH/);
  assert.match(drawer, /value[^<]*1 ETH/);
  assert.equal(loaded.api.runtime.modal.rows[1][1], '1 ETH');
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

test('close all reports each failed token with its own reason', async () => {
  const loaded = loadContent();
  const staleAddress = ADDRESS_B;
  const rejectedAddress = '0x3333333333333333333333333333333333333333';
  const positions = [
    { chain: 'eth', tokenAddress: ADDRESS_A, symbol: 'CLOSED' },
    { chain: 'eth', tokenAddress: staleAddress, symbol: 'STALE' },
    { chain: 'eth', tokenAddress: rejectedAddress, symbol: 'REJECTED' }
  ];
  loaded.api.runtime.state.positions = Object.fromEntries(positions.map((position) => [
    loaded.context.Tango.Engine.positionKey(position.chain, position.tokenAddress), position
  ]));
  loaded.context.Tango.ChainView.positions = () => positions;
  loaded.context.Tango.ChainView.closeOrders = () => [
    { token: { chain: 'eth', address: ADDRESS_A, symbol: 'CLOSED' }, quote: {} },
    { token: { chain: 'eth', address: rejectedAddress, symbol: 'REJECTED' }, quote: {} }
  ];
  loaded.context.Tango.Store.executeCloseAll = async () => ({
    state: loaded.api.runtime.state,
    trades: [{}],
    failures: [{
      order: { token: { chain: 'eth', address: rejectedAddress, symbol: 'REJECTED' } },
      reason: 'invalidQuote'
    }]
  });

  await loaded.api.commitCloseAll();

  assert.match(loaded.api.runtime.toast.message, /STALE: staleQuote/);
  assert.match(loaded.api.runtime.toast.message, /REJECTED: invalidQuote/);
  assert.match(loaded.api.runtime.toast.message, /1\/3/);
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

test('a pending quick-buy cannot execute after same-chain navigation', async () => {
  const nativeGate = deferred();
  const loaded = loadContent({
    sendMessage: (message) => message.type === 'TANGO_GET_NATIVE_PRICE' ? nativeGate.promise : Promise.resolve({ ok: true })
  });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  const action = loaded.api.handleQuickBuy({ ...quoteContext(), amountNative: 1 });
  loaded.context.location.href = `https://gmgn.ai/eth/token/${ADDRESS_B}`;
  nativeGate.resolve({ ok: true, price: 3_000, observedAt: loaded.clock.now });
  await action;
  assert.equal(loaded.calls.buy, 0);
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

test('execution refreshes a native observation aged one millisecond beyond quote freshness', async () => {
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
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceUsd, 3_100);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceObservedAt, loaded.clock.now);
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

test('EVM market-cap-only GMGN observation falls back to a priced DEX quote before execution', async () => {
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
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 2);
  assert.equal(loaded.calls.buyOrders[0].quote.source, 'DEXSCREENER');
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceObservedAt, loaded.clock.now - 1_000);
});

test('non-Pump Solana trench quick-buy fails closed on list market cap and executes only a fresh real-price quote', async () => {
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
  assert.equal(unavailable.calls.buy, 0);

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
  assert.equal(resolved.calls.buyOrders[0].quote.priceUsd, 0.002);
  assert.equal(resolved.calls.buyOrders[0].quote.source, 'DEXSCREENER');
  assert.equal(resolved.calls.buyOrders[0].quote.valuationMode, 'PRICE');
  assert.equal(resolved.calls.buyOrders[0].quote.nativePriceObservedAt, resolved.clock.now - 1_000);
});

test('content validates a persisted Pump market-cap position after detail metadata replaces trench metadata', () => {
  const address = '11111111111111111111111111111111pump';
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
  const address = '11111111111111111111111111111111pump';
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
