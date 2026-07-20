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
  const listeners = new Map();
  class FakeElement {}
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
    location: { href: `https://gmgn.ai/eth/token/${EVM_ADDRESS}` },
    fetch: fetchImpl,
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage(message) {
      if (message?.type === 'TOKEN_QUOTES') published.push(...message.quotes);
      if (message?.type === 'NATIVE_PRICES') nativePublished.push(...message.prices);
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
        extractNativePrices(payload, observedAt) {
          return (payload.data || [])
            .filter((entry) => ['SOL', 'ETH', 'BNB', 'OKB'].includes(entry.symbol))
            .map((entry) => ({
              symbol: entry.symbol,
              priceUsd: Number(entry.price || entry.price_usd),
              observedAt,
              source: 'GMGN_MAJOR_COIN'
            }));
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
  return { context, published, nativePublished, listeners };
}

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

test('page tap does not create a WebSocket or include GMGN execution endpoints', () => {
  assert.doesNotMatch(source, /new\s+WebSocket\s*\(/);
  assert.doesNotMatch(source, /strategy_order|wallet\/list|swap\/route|sendTransaction|signTransaction/);
});
