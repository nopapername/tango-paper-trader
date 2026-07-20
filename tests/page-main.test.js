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

function loadPageMain(fetchImpl) {
  const published = [];
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
    Date,
    Element: FakeElement,
    URL,
    XMLHttpRequest: FakeXhr,
    location: { href: `https://gmgn.ai/eth/token/${EVM_ADDRESS}` },
    fetch: fetchImpl,
    addEventListener(type, listener) { listeners.set(type, listener); },
    postMessage(message) { if (message?.type === 'TOKEN_QUOTES') published.push(...message.quotes); },
    Tango: {
      GMGNQuotes: {
        extract(payload, chain, observedAt) {
          return [{
            chain, address: payload.address, priceUsd: payload.priceUsd,
            symbol: payload.symbol || '', name: payload.name || '', logoUrl: payload.logoUrl || '',
            observedAt, source: 'GMGN_NETWORK'
          }];
        },
        mergeObservation(previous, next) {
          if (previous && (previous.chain !== next.chain || previous.address !== next.address)) return null;
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
  return { context, published, listeners };
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
