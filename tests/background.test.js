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
const WRONG_BYTE_SOL = '11111111111111111111111111111111pump';

function loadPackagedWorker() {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const workerPath = manifest.background.service_worker;
  const workerUrl = new URL(workerPath, 'chrome-extension://test/');
  const imported = [];
  const listeners = [];
  const installListeners = [];
  const commandListeners = [];
  const context = vm.createContext({
    URL, console, structuredClone,
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { listeners.push(listener); } },
        onInstalled: { addListener(listener) { installListeners.push(listener); } },
        getURL(value) { return `chrome-extension://test/${value}`; },
        openOptionsPage: async () => undefined
      },
      commands: { onCommand: { addListener(listener) { commandListeners.push(listener); } } },
      tabs: { create: async () => undefined },
      storage: {
        local: { get: async () => ({}), set: async () => undefined },
        session: { get: async () => ({}), set: async () => undefined }
      }
    },
    fetch: async () => { throw new Error('must not fetch during bootstrap'); }
  });
  context.importScripts = (...specifiers) => {
    for (const specifier of specifiers) {
      const resolved = new URL(specifier, workerUrl);
      const relative = decodeURIComponent(resolved.pathname.replace(/^\//, ''));
      imported.push({ specifier, relative });
      const dependencySource = fs.readFileSync(path.join(root, relative), 'utf8');
      vm.runInContext(dependencySource, context, { filename: relative });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(root, workerPath), 'utf8'), context, { filename: workerPath });
  return { imported, listeners, installListeners, commandListeners };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

function controlledTimers() {
  let next = 0;
  const pending = new Map();
  return {
    timer(callback, delay) { const id = ++next; pending.set(id, { callback, delay }); return id; },
    clearTimer(id) { pending.delete(id); },
    fire() {
      const jobs = [...pending.values()]; pending.clear();
      for (const job of jobs) { assert.equal(job.delay, 6_000); job.callback(); }
    },
    get size() { return pending.size; }
  };
}

function loadBackground(
  fetchImpl,
  clock = { now: 1_000_000 },
  { storageSet, timer = setTimeout, clearTimer = clearTimeout } = {}
) {
  const listeners = [];
  const installListeners = [];
  const commandListeners = [];
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
    setTimeout: timer, clearTimeout: clearTimer, AbortController,
    URL,
    encodeURIComponent,
    console,
    module: { exports: {} },
    chrome: {
      runtime: {
        onMessage: { addListener(listener) { listeners.push(listener); } },
        onInstalled: { addListener(listener) { installListeners.push(listener); } },
        getURL(value) { return `chrome-extension://test/${value}`; },
        openOptionsPage: async () => undefined
      },
      commands: { onCommand: { addListener(listener) { commandListeners.push(listener); } } },
      tabs: { create: async ({ url }) => { openedTabs.push(url); } },
      storage: {
        local: {
          get: async (keys) => Object.fromEntries(keys.filter((key) => key in storageValues).map((key) => [key, structuredClone(storageValues[key])])),
          set: async (next) => {
            if (storageSet) return storageSet(next, storageValues);
            Object.assign(storageValues, structuredClone(next));
          }
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
  return { context, api: context.module.exports, listeners, installListeners, commandListeners, clock, fetchCalls, openedTabs, storageValues };
}

function send(loaded, message) {
  return new Promise((resolve) => {
    const handled = loaded.listeners[0](message, null, resolve);
    if (!handled) resolve({ ok: false, error: 'unhandled' });
  });
}

test('service worker returns typed storageFull byte details from its coordinator', async () => {
  let attempts = 0;
  const loaded = loadBackground(
    async () => { throw new Error('must not fetch'); },
    { now: 2_000 },
    {
      storageSet: async () => {
        attempts += 1;
        const error = new Error('QUOTA_BYTES quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
    }
  );

  const response = await send(loaded, {
    type: 'TANGO_STORE_MUTATE',
    command: { type: 'RESET_ALL' }
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'storageFull');
  assert.equal(response.errorDetails.code, 'storageFull');
  assert.ok(response.errorDetails.measuredBytes > 0);
  assert.equal(response.errorDetails.budgetBytes, 8 * 1024 * 1024);
  assert.equal(attempts, 1);
});

test('service worker emits typed storage details only for valid matching coordinator failures', () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  const cases = [
    {
      name: 'valid storageFull lower bound',
      error: Object.assign(new Error('storageFull'), {
        code: 'storageFull', measuredBytes: 0, budgetBytes: 1
      }),
      typed: true
    },
    {
      name: 'valid importTooLarge relation',
      error: Object.assign(new Error('importTooLarge'), {
        code: 'importTooLarge', measuredBytes: 2, budgetBytes: 1
      }),
      typed: true
    },
    {
      name: 'negative measured bytes',
      error: Object.assign(new Error('storageFull'), {
        code: 'storageFull', measuredBytes: -1, budgetBytes: 1
      })
    },
    {
      name: 'zero budget',
      error: Object.assign(new Error('storageFull'), {
        code: 'storageFull', measuredBytes: 1, budgetBytes: 0
      })
    },
    {
      name: 'import not over budget',
      error: Object.assign(new Error('importTooLarge'), {
        code: 'importTooLarge', measuredBytes: 1, budgetBytes: 1
      })
    },
    {
      name: 'legacy error mismatch',
      error: Object.assign(new Error('importFailed'), {
        code: 'importTooLarge', measuredBytes: 2, budgetBytes: 1
      })
    },
    {
      name: 'unsupported code',
      error: Object.assign(new Error('storageFailed'), {
        code: 'storageFailed', measuredBytes: 2, budgetBytes: 1
      })
    }
  ];

  for (const item of cases) {
    const response = loaded.context.coordinatorFailureResponse(item.error);
    assert.equal(response.error, item.error.message, item.name);
    assert.equal(Object.hasOwn(response, 'errorDetails'), item.typed === true, item.name);
  }
});

test('first install opens onboarding exactly once while updates never open it', async () => {
  const loaded = loadBackground(async () => jsonResponse({}));
  assert.equal(loaded.installListeners.length, 1);

  await loaded.installListeners[0]({ reason: 'update' });
  await loaded.installListeners[0]({ reason: 'browser_update' });
  await loaded.installListeners[0]({ reason: 'install' });
  await loaded.installListeners[0]({ reason: 'install' });

  assert.deepEqual(loaded.openedTabs, ['chrome-extension://test/dashboard.html?onboarding=1']);
});

test('packaged MV3 worker executes its real worker-relative import sequence before registering', () => {
  let loaded;
  assert.doesNotThrow(() => { loaded = loadPackagedWorker(); });
  assert.deepEqual(loaded.imported.map(({ specifier }) => specifier), [
    'core/chains.js',
    'core/supply.js',
    'shared/constants.js',
    'core/state.js',
    'core/engine.js',
    'core/state-coordinator.js'
  ]);
  assert.deepEqual(loaded.imported.map(({ relative }) => relative), [
    'src/core/chains.js',
    'src/core/supply.js',
    'src/shared/constants.js',
    'src/core/state.js',
    'src/core/engine.js',
    'src/core/state-coordinator.js'
  ]);
  assert.equal(loaded.listeners.length, 1);
});

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

test('generic GMGN entry opens only the shared referral URL', async () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  const response = await send(loaded, { type: 'TANGO_OPEN_GMGN' });
  assert.equal(response.ok, true);
  assert.equal(loaded.context.Tango.GMGN_ENTRY_URL, 'https://gmgn.ai/r/X9cuc5jd?chain=bsc');
  assert.deepEqual(loaded.openedTabs, [loaded.context.Tango.GMGN_ENTRY_URL]);
});

test('Alt+Shift+P command toggles only the enabled setting in serialized order', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../manifest.json'), 'utf8'));
  assert.equal(manifest.commands?.['toggle-paper-trading']?.suggested_key?.default, 'Alt+Shift+P');
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  const settingsKey = loaded.context.Tango.SETTINGS_KEY;
  loaded.storageValues[settingsKey] = loaded.context.Tango.State.normalizeSettings({ enabled: true, selectedChain: 'base' });
  assert.equal(loaded.commandListeners.length, 1);

  await loaded.commandListeners[0]('unknown-command');
  assert.equal(loaded.storageValues[settingsKey].enabled, true);
  await Promise.all([
    loaded.commandListeners[0]('toggle-paper-trading'),
    loaded.commandListeners[0]('toggle-paper-trading')
  ]);
  assert.equal(loaded.storageValues[settingsKey].enabled, true);
  assert.equal(loaded.storageValues[settingsKey].selectedChain, 'base');
  await loaded.commandListeners[0]('toggle-paper-trading');
  assert.equal(loaded.storageValues[settingsKey].enabled, false);
});

test('Dashboard deep links validate and carry the requested tab and current chain', async () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  const opened = await send(loaded, { type: 'TANGO_OPEN_DASHBOARD', tab: 'history', chain: 'base' });
  assert.equal(opened.ok, true);
  assert.equal(loaded.openedTabs.at(-1), 'chrome-extension://test/dashboard.html?chain=base#history');

  const invalid = await send(loaded, { type: 'TANGO_OPEN_DASHBOARD', tab: 'javascript:bad', chain: 'unknown' });
  assert.equal(invalid.ok, false);
  assert.equal(loaded.openedTabs.length, 1);
});

test('wrong-byte Solana identities cannot open routes or start quote requests', async () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  const opened = await send(loaded, {
    type: 'TANGO_OPEN_TOKEN',
    url: `https://gmgn.ai/sol/token/${WRONG_BYTE_SOL}`
  });
  assert.equal(opened.ok, false);
  assert.equal(opened.error, 'Invalid GMGN token URL');
  assert.deepEqual(await loaded.context.getTokenQuote('sol', WRONG_BYTE_SOL), null);
  assert.equal(loaded.openedTabs.length, 0);
  assert.equal(loaded.fetchCalls.length, 0);
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

test('native fetch timeout aborts coalesced requests and allows a fresh retry', async () => {
  const timers = controlledTimers();
  let attempts = 0;
  let firstSignal;
  const loaded = loadBackground(async (_url, options) => {
    attempts += 1;
    if (attempts === 1) { firstSignal = options.signal; return new Promise(() => {}); }
    return jsonResponse({ ethereum: { usd: 2_500 } });
  }, { now: 1_000_000 }, timers);
  const first = assert.rejects(loaded.context.getNativePrice('eth'), /unavailable/);
  const shared = assert.rejects(loaded.context.getNativePrice('base'), /unavailable/);
  assert.equal(attempts, 1);
  assert.equal(timers.size, 1);
  timers.fire();
  await Promise.all([first, shared]);
  assert.equal(firstSignal.aborted, true);
  assert.equal(timers.size, 0);
  assert.equal(await loaded.context.getNativePrice('base'), 2_500);
  assert.equal(attempts, 2);
  assert.equal(timers.size, 0);
});

test('stalled response JSON times out without caching a late quote or locking retry', async () => {
  const timers = controlledTimers();
  const body = deferred();
  let attempts = 0;
  let firstSignal;
  const loaded = loadBackground(async (_url, options) => {
    attempts += 1;
    if (attempts === 1) { firstSignal = options.signal; return { ok: true, json: () => body.promise }; }
    return jsonResponse([{ baseToken: { address: ADDRESS }, priceUsd: '3' }]);
  }, { now: 1_000_000 }, timers);
  const failed = assert.rejects(loaded.context.getTokenQuote('sol', ADDRESS), /timed out/);
  await new Promise((resolve) => setImmediate(resolve));
  timers.fire();
  await failed;
  assert.equal(firstSignal.aborted, true);
  assert.equal(loaded.api._tokenQuoteCache.size, 0);
  assert.equal((await loaded.context.getTokenQuote('sol', ADDRESS)).priceUsd, 3);
  body.resolve([{ baseToken: { address: ADDRESS }, priceUsd: '999' }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await loaded.context.getTokenQuote('sol', ADDRESS)).priceUsd, 3);
  assert.equal(attempts, 2);
  assert.equal(timers.size, 0);
});

test('SOL fallback has a bounded timeout and releases both pending provider requests', async () => {
  const timers = controlledTimers();
  const signals = [];
  let recover = false;
  const loaded = loadBackground(async (url, options) => {
    signals.push(options.signal);
    if (!recover) return new Promise(() => {});
    return jsonResponse({ solana: { usd: 150 } });
  }, { now: 1_000_000 }, timers);
  const failed = assert.rejects(loaded.context.getNativePrice('sol'), /timed out/);
  timers.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 2);
  assert.equal(timers.size, 1);
  timers.fire();
  await failed;
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(timers.size, 0);
  recover = true;
  assert.equal(await loaded.context.getNativePrice('sol'), 150);
  assert.equal(signals.length, 3);
});
