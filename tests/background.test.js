const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/background.js'), 'utf8');
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
  class FakeDate extends Date { static now() { return clock.now; } }
  const context = {
    fetch: fetchImpl,
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
      tabs: { create: async () => undefined },
      storage: { session: { get: async () => ({}), set: async () => undefined } }
    }
  };
  vm.runInNewContext(source, context, { filename: 'src/background.js' });
  return { context, api: context.module.exports, listeners, clock };
}

test('concurrent SOL requests share one fetch and preserve the 30 second cache', async () => {
  const gate = deferred();
  let calls = 0;
  const loaded = loadBackground(() => { calls += 1; return gate.promise; });
  const first = loaded.context.getSolPrice();
  const second = loaded.context.getSolPrice();
  assert.equal(calls, 1);
  gate.resolve(jsonResponse({ solana: { usd: 150 } }));
  assert.deepEqual(await Promise.all([first, second]), [150, 150]);
  loaded.clock.now += 29_999;
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
