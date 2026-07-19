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
    ensureTokenQuote, ensureNativePrice, freshNativePrice, rememberNativePrice
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
    chainSettings: { eth: { ...chain }, base: { ...chain } }, sellPresets: [100]
  };
}

function loadContent({ href = `https://gmgn.ai/eth/token/${ADDRESS_A}`, readCurrentToken, sendMessage } = {}) {
  assert.notEqual(instrumentedSource, contentSource, 'content test harness must replace startup with runtime exports');
  const messages = [];
  const calls = { buy: 0, save: 0 };
  const clock = { now: 1_000_000 };
  class FakeDate extends Date {
    constructor(...args) { super(args.length ? args[0] : clock.now); }
    static now() { return clock.now; }
  }
  const shell = {
    className: '', innerHTML: '',
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }
  };
  const shadow = {
    append() {}, addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }
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
    addEventListener() {},
    removeEventListener() {},
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
      getAll: async () => ({ state: defaultState(), settings: defaultSettings() }),
      saveState: async () => { calls.save += 1; }, saveSettings: async () => {}, subscribe() {}
    },
    Engine: {
      positionKey: (chain, address) => `${chain}:${String(address).toLowerCase()}`,
      validateQuote(quote) {
        const hasValue = Number(quote?.priceUsd || quote?.marketCapUsd) > 0;
        const fresh = Number(quote?.observedAt || 0) > 0 && FakeDate.now() - Number(quote.observedAt) <= 15_000;
        return hasValue && Number(quote?.nativePriceUsd) > 0 && fresh ? { ok: true } : { ok: false, reason: fresh ? 'invalidQuote' : 'staleQuote' };
      },
      updatePositionMetadata: (state) => state,
      updatePositionQuote: (state) => state,
      executeBuy(state) { calls.buy += 1; return { state, trade: {} }; },
      executeSell: (state) => ({ state, trade: {} }), executeCloseAll: (state) => ({ state, trades: [], failures: [] }),
      portfolioSummary: () => ({ totalPnlNative: 0, positionsValueNative: 0, positionCount: 0 }),
      markPosition: () => ({ unrealizedPnlNative: 0, valueNative: 0, roi: 0 }), breakevenSellPercent: () => null
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
  return { api, calls, clock, context, messages };
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
