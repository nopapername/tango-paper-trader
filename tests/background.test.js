const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/background.js'), 'utf8');
const chainsSource = fs.readFileSync(path.resolve(__dirname, '../src/core/chains.js'), 'utf8');
const constantsSource = fs.readFileSync(path.resolve(__dirname, '../src/shared/constants.js'), 'utf8');
const stateSource = fs.readFileSync(path.resolve(__dirname, '../src/core/state.js'), 'utf8');
const engineSource = fs.readFileSync(path.resolve(__dirname, '../src/core/engine.js'), 'utf8');
const coordinatorSource = fs.readFileSync(path.resolve(__dirname, '../src/core/state-coordinator.js'), 'utf8');
const ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function loadBackground(fetchImpl, clock = { now: 1_000_000 }) {
  const listeners = [];
  const fetchCalls = [];
  const openedTabs = [];
  const storageValues = {};
  class FakeDate extends Date { static now() { return clock.now; } }
  const context = {
    fetch: (...args) => {
      fetchCalls.push(args);
      return fetchImpl(...args);
    },
    Date: FakeDate,
    URL,
    encodeURIComponent,
    console,
    module: { exports: {} },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { listeners.push(listener); } },
        getURL(value) { return `chrome-extension://test/${value}`; },
        openOptionsPage: async () => undefined
      },
      tabs: { create: async ({ url }) => { openedTabs.push(url); } },
      storage: {
        local: {
          get: async (keys) => Object.fromEntries(keys.filter((key) => key in storageValues).map((key) => [key, structuredClone(storageValues[key])])),
          set: async (next) => { Object.assign(storageValues, structuredClone(next)); }
        },
        session: { get: async () => ({}), set: async () => undefined }
      }
    }
  };
  vm.runInNewContext(chainsSource, context, { filename: 'src/core/chains.js' });
  vm.runInNewContext(constantsSource, context, { filename: 'src/shared/constants.js' });
  vm.runInNewContext(stateSource, context, { filename: 'src/core/state.js' });
  vm.runInNewContext(engineSource, context, { filename: 'src/core/engine.js' });
  vm.runInNewContext(coordinatorSource, context, { filename: 'src/core/state-coordinator.js' });
  vm.runInNewContext(source, context, { filename: 'src/background.js' });
  return { context, api: context.module.exports, listeners, clock, fetchCalls, openedTabs, storageValues };
}

function send(loaded, message) {
  return new Promise((resolve) => {
    const handled = loaded.listeners[0](message, null, resolve);
    if (!handled) resolve({ ok: false, error: 'unhandled' });
  });
}

test('token tab messages accept every registered GMGN chain and reject non-token routes', async () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  const send = (url) => new Promise((resolve) => {
    loaded.listeners[0]({ type: 'TANGO_OPEN_TOKEN', url }, null, resolve);
  });
  const evmAddress = '0x1111111111111111111111111111111111111111';
  const cases = ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer'].map((chain) => ({
    chain,
    address: chain === 'sol' ? ADDRESS : evmAddress
  }));
  for (const item of cases) {
    const url = `https://gmgn.ai/${item.chain}/token/${item.address}`;
    assert.equal((await send(url)).ok, true);
    assert.equal(loaded.openedTabs.at(-1), url);
  }
  const rejected = await send('https://gmgn.ai/base/monitor');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'Invalid GMGN token URL');
});

test('the service worker owns one serialized mutation coordinator for every extension context', async () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  const initial = loaded.context.Tango.State.createInitialState({ now: 1 });
  initial.initialized = true;
  loaded.storageValues[loaded.context.Tango.STORAGE_KEY] = initial;
  loaded.storageValues[loaded.context.Tango.SETTINGS_KEY] = loaded.context.Tango.State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 }, bsc: { networkFeeNative: 0 } }
  });
  const quote = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: loaded.clock.now, nativePriceObservedAt: loaded.clock.now
  };

  const [eth, bsc] = await Promise.all([
    send(loaded, {
      type: 'TANGO_STORE_MUTATE',
      command: {
        type: 'EXECUTE_BUY',
        order: { token: { chain: 'eth', address: '0x8888888888888888888888888888888888888888' }, quote, amountNative: 1 }
      }
    }),
    send(loaded, {
      type: 'TANGO_STORE_MUTATE',
      command: {
        type: 'EXECUTE_BUY',
        order: { token: { chain: 'bsc', address: '0x9999999999999999999999999999999999999999' }, quote, amountNative: 1 }
      }
    })
  ]);
  const snapshot = await send(loaded, { type: 'TANGO_STORE_GET_ALL' });

  assert.equal(eth.ok, true);
  assert.equal(bsc.ok, true);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.result.state.accounts.eth.cashBalanceNative, 9);
  assert.equal(snapshot.result.state.accounts.bsc.cashBalanceNative, 9);
  assert.equal(snapshot.result.state.stateRevision, 2);
});

test('ETH native requests coalesce across Ethereum and Base', async () => {
  const loaded = loadBackground(async () => jsonResponse({ ethereum: { usd: 2500 } }));
  const [eth, base] = await Promise.all([loaded.context.getNativePrice('eth'), loaded.context.getNativePrice('base')]);
  assert.equal(eth, 2500); assert.equal(base, 2500); assert.equal(loaded.fetchCalls.length, 1);
});

test('shared ETH and Base native cache reuses through quote freshness and refreshes one millisecond later', async () => {
  let fetchCount = 0;
  const loaded = loadBackground(async () => {
    fetchCount += 1;
    return jsonResponse({ ethereum: { usd: 2_500 + fetchCount } });
  });
  const send = (chain) => new Promise((resolve) => {
    loaded.listeners[0]({ type: 'TANGO_GET_NATIVE_PRICE', chain }, null, resolve);
  });
  const eth = await send('eth');
  loaded.clock.now += 15_000;
  const boundary = await send('base');
  loaded.clock.now += 1;
  const refreshed = await send('base');

  assert.equal(eth.ok, true); assert.equal(eth.price, 2_501); assert.equal(eth.observedAt, 1_000_000);
  assert.equal(boundary.ok, true); assert.equal(boundary.price, eth.price); assert.equal(boundary.observedAt, eth.observedAt);
  assert.equal(refreshed.ok, true); assert.equal(refreshed.price, 2_502);
  assert.equal(refreshed.observedAt, 1_015_001);
  assert.equal(loaded.fetchCalls.length, 2);
});

test('the same EVM address uses independent DEX requests per chain', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  const loaded = loadBackground(async (url) => jsonResponse([{ baseToken: { address }, priceUsd: url.includes('/base/') ? 2 : 1, liquidity: { usd: 10 } }]));
  const [eth, base] = await Promise.all([loaded.context.getTokenQuote('eth', address), loaded.context.getTokenQuote('base', address)]);
  assert.equal(eth.priceUsd, 1); assert.equal(base.priceUsd, 2); assert.equal(loaded.fetchCalls.length, 2);
});

test('token quote requests validate addresses before provider access and normalize mixed-case EVM identity', async () => {
  const mixed = '0xA111111111111111111111111111111111111111';
  const loaded = loadBackground(async (url) => jsonResponse([{
    baseToken: { address: mixed }, priceUsd: '2', liquidity: { usd: 10 }
  }]));
  assert.equal(await loaded.context.getTokenQuote('eth', 'bad'), null);
  assert.equal(loaded.fetchCalls.length, 0);

  const quote = await loaded.context.getTokenQuote('eth', mixed);
  assert.equal(quote.priceUsd, 2);
  assert.match(String(loaded.fetchCalls[0][0]), /0xa111111111111111111111111111111111111111$/);
});

test('non-finite provider prices never enter native or token caches', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  const token = loadBackground(async () => jsonResponse([{
    baseToken: { address }, priceUsd: Infinity, marketCap: Infinity, liquidity: { usd: Infinity }
  }]));
  assert.equal(await token.context.getTokenQuote('eth', address), null);

  const native = loadBackground(async () => jsonResponse({ ethereum: { usd: Infinity } }));
  await assert.rejects(native.context.getNativePrice('eth'), /unavailable/);
});

test('a chain without verified DEX mapping fails closed without fetch', async () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  assert.equal(await loaded.context.getTokenQuote('robinhood', '0x1111111111111111111111111111111111111111'), null);
  assert.equal(loaded.fetchCalls.length, 0);
});

test('concurrent SOL requests share one fetch through the 15 second execution freshness boundary', async () => {
  const gate = deferred();
  let calls = 0;
  const loaded = loadBackground(() => { calls += 1; return gate.promise; });
  const first = loaded.context.getSolPrice();
  const second = loaded.context.getSolPrice();
  assert.equal(calls, 1);
  gate.resolve(jsonResponse({ solana: { usd: 150 } }));
  assert.deepEqual(await Promise.all([first, second]), [150, 150]);
  loaded.clock.now += 15_000;
  assert.equal(await loaded.context.getSolPrice(), 150);
  assert.equal(calls, 1);
  loaded.clock.now += 1;
  assert.equal(await loaded.context.getSolPrice(), 150);
  assert.equal(calls, 2);
});

test('a fully rejected SOL request clears its in-flight slot and can retry', async () => {
  let calls = 0;
  const loaded = loadBackground(async () => {
    calls += 1;
    if (calls < 3) throw new Error('offline');
    return jsonResponse({ solana: { usd: 151 } });
  });
  await assert.rejects(loaded.context.getSolPrice(), /offline/);
  assert.equal(await loaded.context.getSolPrice(), 151);
  assert.equal(calls, 3);
});

test('concurrent token requests share one fetch and choose the most liquid matching pair', async () => {
  const gate = deferred();
  let calls = 0;
  const loaded = loadBackground(() => { calls += 1; return gate.promise; });
  const first = loaded.context.getTokenQuote('sol', ADDRESS);
  const second = loaded.context.getTokenQuote('sol', ADDRESS);
  assert.equal(calls, 1);
  gate.resolve(jsonResponse([
    { baseToken: { address: ADDRESS }, priceUsd: '1', marketCap: 1_000, liquidity: { usd: 20 } },
    { baseToken: { address: ADDRESS }, priceUsd: '2', marketCap: 2_000, liquidity: { usd: 200 } },
    { baseToken: { address: 'DifferentAddress1111111111111111111111111' }, priceUsd: '9', liquidity: { usd: 999 } }
  ]));
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.priceUsd, 2);
  assert.equal(right.priceUsd, 2);
  assert.equal(calls, 1);
});

test('different token addresses remain independent', async () => {
  let calls = 0;
  const loaded = loadBackground(async (url) => {
    calls += 1;
    const address = decodeURIComponent(String(url).split('/').at(-1));
    return jsonResponse([{ baseToken: { address }, priceUsd: '1', liquidity: { usd: 1 } }]);
  });
  await Promise.all([
    loaded.context.getTokenQuote('sol', ADDRESS),
    loaded.context.getTokenQuote('sol', WRAPPED_SOL)
  ]);
  assert.equal(calls, 2);
});

test('a failed token request clears its in-flight entry and can retry', async () => {
  let calls = 0;
  const loaded = loadBackground(async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return jsonResponse([{ baseToken: { address: ADDRESS }, priceUsd: '3', liquidity: { usd: 1 } }]);
  });
  await assert.rejects(loaded.context.getTokenQuote('sol', ADDRESS), /offline/);
  assert.equal((await loaded.context.getTokenQuote('sol', ADDRESS)).priceUsd, 3);
  assert.equal(calls, 2);
});

test('CoinGecko failure still falls back to Wrapped SOL', async () => {
  const urls = [];
  const loaded = loadBackground(async (url) => {
    urls.push(String(url));
    if (String(url).includes('coingecko')) return jsonResponse(null, { ok: false, status: 503 });
    return jsonResponse([{ baseToken: { address: WRAPPED_SOL }, priceUsd: '145', liquidity: { usd: 1 } }]);
  });
  assert.equal(await loaded.context.getSolPrice(), 145);
  assert.equal(urls.length, 2);
});

test('cached Wrapped SOL fallback preserves the DEX quote observation timestamp', async () => {
  const loaded = loadBackground(async (url) => {
    if (String(url).includes('coingecko')) return jsonResponse(null, { ok: false, status: 503 });
    return jsonResponse([{ baseToken: { address: WRAPPED_SOL }, priceUsd: '145', liquidity: { usd: 1 } }]);
  });
  const wrapped = await loaded.context.getTokenQuote('sol', WRAPPED_SOL);
  loaded.clock.now += 10_000;
  const native = await new Promise((resolve) => {
    loaded.listeners[0]({ type: 'TANGO_GET_NATIVE_PRICE', chain: 'sol' }, null, resolve);
  });
  assert.equal(native.price, 145);
  assert.equal(native.observedAt, wrapped.observedAt);
});

test('expired token cache entries are removed while fresh entries remain', async () => {
  const loaded = loadBackground(async () => jsonResponse([
    { baseToken: { address: ADDRESS }, priceUsd: '4', liquidity: { usd: 1 } }
  ]));
  loaded.api._tokenQuoteCache.set('expired', { quote: { priceUsd: 1 }, fetchedAt: loaded.clock.now - 15_001 });
  loaded.api._tokenQuoteCache.set('fresh', { quote: { priceUsd: 2 }, fetchedAt: loaded.clock.now - 14_999 });
  await loaded.context.getTokenQuote('sol', ADDRESS);
  assert.equal(loaded.api._tokenQuoteCache.has('expired'), false);
  assert.equal(loaded.api._tokenQuoteCache.has('fresh'), true);
});
