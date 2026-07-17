# Conservative Structure and Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove deterministic wasted work and improve internal boundaries without changing any user-visible behavior or runtime contract.

**Architecture:** Extract chart-marker payload construction into one dependency-free IIFE/CommonJS helper, keep browser orchestration in the existing content script, coalesce identical in-flight background requests, and make the existing extension validator enforce static contracts. Every runtime change is preceded by a focused characterization test and followed by the full test/check/build baseline.

**Tech Stack:** Chrome Extension Manifest V3, browser IIFEs, Node.js 22 built-in test runner, `node:vm`, and dependency-free PowerShell/npm scripts.

## Global Constraints

- Do not change GMGN token identity detection, detail-scope verification, quick-buy injection, or original-button restoration.
- Do not change MutationObserver behavior, route polling, timer frequencies, chart scale fitting, or marker placement.
- Do not change trading formulas, quote freshness windows, cache freshness windows, quote-source priority, fallbacks, storage schema, or import/export formats.
- Do not change HTML, CSS, translations, visible copy, message names, message payloads, permissions, or supported routes.
- Do not introduce third-party dependencies, ES modules, or a bundler.
- Preserve the existing IIFE/global namespace and CommonJS testing conventions.
- Use test-first red/green/refactor cycles and keep each task independently releasable.

---

## File Map

- Create `src/content/markers.js`: pure marker-payload construction; attaches `Tango.Markers` and exports through CommonJS.
- Create `tests/markers.test.js`: golden behavior for marker filtering, ordering, IDs, labels, and price derivation.
- Create `tests/content-structure.test.js`: deterministic assertions for no-frame short-circuiting and summary reuse.
- Modify `src/content/content.js`: delegate marker construction, query frames before scanning trades, and pass the existing summary into the drawer.
- Modify `manifest.json`: load `markers.js` immediately before `content.js` in the isolated-world content script.
- Create `tests/background.test.js`: background concurrency, retry, cache, fallback, and pair-selection characterization.
- Modify `src/background.js`: in-flight request coalescing and expired-cache cleanup.
- Create `tests/validate-extension.test.js`: validation behavior for the repository and malformed inputs.
- Modify `scripts/validate-extension.js`: callable validator functions plus version/order/syntax checks.

---

### Task 1: Extract Marker Payloads and Remove Redundant Content Work

**Files:**
- Create: `src/content/markers.js`
- Create: `tests/markers.test.js`
- Create: `tests/content-structure.test.js`
- Modify: `src/content/content.js:735-826`
- Modify: `manifest.json:31-42`

**Interfaces:**
- Consumes: `{ current, position, trades, labels }`, where `current` has `token` and `quote`, `labels` has `entry`, `exit`, and `hide` strings.
- Produces: `Tango.Markers.buildPayload(input)` and CommonJS `{ buildPayload }`; returns the existing `{ markers: [] }` empty shape or `{ tokenAddress, currentPrice, currentMarketCap, markers }` populated shape.

- [ ] **Step 1: Write failing marker characterization tests**

Create `tests/markers.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
const { buildPayload } = require('../src/content/markers.js');

const ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
const labels = { entry: 'Paper Buy', exit: 'Paper Sell', hide: 'Hide line' };

test('returns the existing empty marker shape without a current token', () => {
  assert.deepEqual(buildPayload({ current: null, position: null, trades: [], labels }), { markers: [] });
});

test('position entry wins and the first four matching sells keep trade order', () => {
  const current = {
    token: { chain: 'sol', address: ADDRESS },
    quote: { priceUsd: 2, marketCapUsd: 2_000 }
  };
  const trades = [
    { id: 'sell-1', chain: 'sol', tokenAddress: ADDRESS.toLowerCase(), side: 'SELL', marketCapUsd: 1_500, observedPriceUsd: 1.5 },
    { id: 'buy-1', chain: 'sol', tokenAddress: ADDRESS, side: 'BUY', marketCapUsd: 1_200, observedPriceUsd: 1.2 },
    { id: 'sell-2', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_600, observedPriceUsd: 0 },
    { id: 'wrong-chain', chain: 'eth', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 9_999, observedPriceUsd: 9.9 },
    { id: 'sell-3', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_700, observedPriceUsd: 1.7 },
    { id: 'sell-4', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_800, observedPriceUsd: 1.8 },
    { id: 'sell-5', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_900, observedPriceUsd: 1.9 }
  ];

  const payload = buildPayload({
    current,
    position: { averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1 },
    trades,
    labels
  });

  assert.deepEqual(payload, {
    tokenAddress: ADDRESS.toLowerCase(),
    currentPrice: 2,
    currentMarketCap: 2_000,
    markers: [
      { id: `entry:${ADDRESS.toLowerCase()}`, side: 'BUY', marketCap: 1_000, price: 1, label: 'Paper Buy', closeLabel: 'Hide line' },
      { id: 'sell:sell-1', side: 'SELL', marketCap: 1_500, price: 1.5, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: 'sell:sell-2', side: 'SELL', marketCap: 1_600, price: 1.6, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: 'sell:sell-3', side: 'SELL', marketCap: 1_700, price: 1.7, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: 'sell:sell-4', side: 'SELL', marketCap: 1_800, price: 1.8, label: 'Paper Sell', closeLabel: 'Hide line' }
    ]
  });
});

test('first matching buy is the fallback entry and missing trade ids keep the legacy id', () => {
  const current = {
    token: { chain: 'sol', address: ADDRESS },
    quote: { priceUsd: 0.000002, marketCapUsd: 2_000 }
  };
  const payload = buildPayload({
    current,
    position: null,
    trades: [
      { chain: 'sol', tokenAddress: ADDRESS, side: 'BUY', marketCapUsd: 1_000, observedPriceUsd: 0 },
      { chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_500, observedPriceUsd: 0, executedAt: 123 }
    ],
    labels
  });

  assert.equal(payload.markers[0].price, 0.000001);
  assert.deepEqual(payload.markers[1], {
    id: 'sell:123:1500', side: 'SELL', marketCap: 1_500, price: 0.0000015,
    label: 'Paper Sell', closeLabel: 'Hide line'
  });
});
```

- [ ] **Step 2: Write failing content-structure performance assertions**

Create `tests/content-structure.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');

function between(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, `missing ${startText}`);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test('chart frames are checked before a marker payload scans trades', () => {
  const block = between('function syncChartMarkers(', 'function renderModal(');
  const query = block.indexOf('document.querySelectorAll(');
  const guard = block.indexOf('if (!frames.length) return;');
  const payload = block.indexOf('chartMarkerPayload()');
  assert.ok(query >= 0 && guard > query && payload > guard);
});

test('render computes one portfolio summary and passes it to the drawer', () => {
  const drawer = between('function renderDrawer(', 'function chartMarkerPayload(');
  const render = between('function render()', 'function bindEvents()');
  assert.match(drawer, /^function renderDrawer\(summary\)/);
  assert.doesNotMatch(drawer, /portfolioSummary/);
  assert.match(render, /const summary = Tango\.Engine\.portfolioSummary\(runtime\.state\)/);
  assert.match(render, /renderDrawer\(summary\)/);
});
```

- [ ] **Step 3: Run the new tests and verify the RED state**

Run:

```powershell
node --test tests/markers.test.js tests/content-structure.test.js
```

Expected: FAIL because `src/content/markers.js` is missing; the structure tests also fail because payload construction currently precedes the frame query and `renderDrawer` recomputes the summary.

- [ ] **Step 4: Implement the pure marker helper**

Create `src/content/markers.js` with:

```js
(function initMarkers(global) {
  const Tango = global.Tango = global.Tango || {};

  function buildPayload({ current, position, trades, labels }) {
    if (!current?.token) return { markers: [] };
    const address = current.token.address.toLowerCase();
    const currentPrice = Number(current.quote.priceUsd || 0);
    const currentMarketCap = Number(current.quote.marketCapUsd || 0);
    let firstBuy = null;
    const sellTrades = [];

    for (const trade of trades || []) {
      if (trade.chain !== current.token.chain || trade.tokenAddress.toLowerCase() !== address || !(Number(trade.marketCapUsd) > 0)) continue;
      if (!firstBuy && trade.side === 'BUY') firstBuy = trade;
      if (trade.side === 'SELL' && sellTrades.length < 4) sellTrades.push(trade);
      if (firstBuy && sellTrades.length === 4) break;
    }

    const priceAtMarketCap = (marketCap, recordedPrice = 0) => Number(recordedPrice) > 0
      ? Number(recordedPrice)
      : currentPrice > 0 && currentMarketCap > 0
        ? currentPrice * Number(marketCap) / currentMarketCap
        : 0;
    const markers = [];
    const entryMarketCap = Number(position?.averageEntryMarketCap || firstBuy?.marketCapUsd || 0);
    if (entryMarketCap > 0) markers.push({
      id: `entry:${address}`, side: 'BUY', marketCap: entryMarketCap,
      price: priceAtMarketCap(entryMarketCap, position?.averageEntryPriceUsd), label: labels.entry, closeLabel: labels.hide
    });
    sellTrades.forEach((trade) => {
      markers.push({
        id: `sell:${trade.id || `${trade.executedAt}:${trade.marketCapUsd}`}`, side: 'SELL', marketCap: Number(trade.marketCapUsd),
        price: priceAtMarketCap(trade.marketCapUsd, trade.observedPriceUsd), label: labels.exit, closeLabel: labels.hide
      });
    });
    return { tokenAddress: address, currentPrice, currentMarketCap, markers };
  }

  Tango.Markers = { buildPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Markers;
})(globalThis);
```

- [ ] **Step 5: Integrate the helper without changing orchestration contracts**

In `manifest.json`, insert the helper immediately before the existing content script:

```json
"src/adapters/gmgn.js",
"src/content/markers.js",
"src/content/content.js"
```

Replace `chartMarkerPayload()` in `src/content/content.js` with:

```js
function chartMarkerPayload() {
  if (!runtime.current?.token) return { markers: [] };
  return Tango.Markers.buildPayload({
    current: runtime.current,
    position: currentPosition(),
    trades: runtime.state.trades || [],
    labels: { entry: t('paperBuy'), exit: t('paperSell'), hide: t('hideChartLine') }
  });
}
```

Replace `syncChartMarkers()` with:

```js
function syncChartMarkers(force = false) {
  const frames = document.querySelectorAll('iframe[title="Financial Chart"], [data-sentry-component="TradingView"] iframe');
  if (!frames.length) return;
  const payload = chartMarkerPayload();
  const signature = JSON.stringify(payload);
  frames.forEach((frame) => {
    if (!force && runtime.markerPayloads.get(frame) === signature) return;
    runtime.markerPayloads.set(frame, signature);
    frame.contentWindow?.postMessage({ source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload }, '*');
  });
}
```

Change the drawer signature and remove its local summary calculation:

```js
function renderDrawer(summary) {
  if (!runtime.drawerOpen) return '';
  const positions = Object.values(runtime.state.positions || {});
```

Change the render template call from `renderDrawer()` to `renderDrawer(summary)`:

```js
const markup = `${renderBar(summary)}${renderPanel()}${renderDrawer(summary)}${renderPnlCalendar()}${renderModal()}${runtime.toast ? `<div class="tango-toast ${esc(runtime.toast.type)}">${esc(runtime.toast.message)}</div>` : ''}`;
```

- [ ] **Step 6: Run targeted and full verification**

Run:

```powershell
node --test tests/markers.test.js tests/content-structure.test.js
npm.cmd test
npm.cmd run check
npm.cmd run build
```

Expected: marker and structure tests PASS; the full suite passes with 43 tests; validation reports 14 referenced files and the build exits 0.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/content/markers.js src/content/content.js manifest.json tests/markers.test.js tests/content-structure.test.js
git commit -m "refactor: extract chart marker payloads"
```

---

### Task 2: Coalesce Background Quote Requests

**Files:**
- Create: `tests/background.test.js`
- Modify: `src/background.js:1-98`

**Interfaces:**
- Consumes: existing `TANGO_GET_SOL_PRICE` and `TANGO_GET_TOKEN_QUOTE` message inputs; existing CoinGecko and DEX Screener responses.
- Produces: unchanged message response shapes; internal `getSolPrice()` and `getTokenQuote(chain, address)` now coalesce identical in-flight work. CommonJS exports are test-only and absent in the service-worker runtime.

- [ ] **Step 1: Write failing background concurrency and cache tests**

Create `tests/background.test.js` with:

```js
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
```

- [ ] **Step 2: Run the background tests and verify the RED state**

Run:

```powershell
node --test tests/background.test.js
```

Expected: FAIL because concurrent cold requests currently issue multiple fetches and `_tokenQuoteCache` is not exported for characterization.

- [ ] **Step 3: Implement in-flight coalescing and expired-cache cleanup**

At the top of `src/background.js`, replace the cache declarations with:

```js
let solPriceCache = { price: 0, fetchedAt: 0 };
let solPriceRequest = null;
const tokenQuoteCache = new Map();
const tokenQuoteRequests = new Map();
const TOKEN_QUOTE_CACHE_MS = 15_000;
```

Replace the current `getSolPrice()` with the following wrapper and unchanged request body:

```js
async function getSolPrice() {
  if (solPriceCache.price > 0 && Date.now() - solPriceCache.fetchedAt < 30_000) return solPriceCache.price;
  if (solPriceRequest) return solPriceRequest;
  solPriceRequest = fetchSolPrice().finally(() => { solPriceRequest = null; });
  return solPriceRequest;
}

async function fetchSolPrice() {
  let price = 0;
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      headers: { accept: 'application/json' }
    });
    if (response.ok) {
      const body = await response.json();
      price = Number(body?.solana?.usd || 0);
    }
  } catch {}
  if (!(price > 0)) {
    const wrappedSol = await getTokenQuote('sol', 'So11111111111111111111111111111111111111112');
    price = Number(wrappedSol?.priceUsd || 0);
  }
  if (!(price > 0)) throw new Error('SOL price is unavailable');
  solPriceCache = { price, fetchedAt: Date.now() };
  return price;
}
```

Replace `getTokenQuote()` with:

```js
async function getTokenQuote(chain, address) {
  if (String(chain || '').toLowerCase() !== 'sol' || !address) return null;
  const key = String(address).toLowerCase();
  const now = Date.now();
  tokenQuoteCache.forEach((entry, cachedKey) => {
    if (now - entry.fetchedAt >= TOKEN_QUOTE_CACHE_MS) tokenQuoteCache.delete(cachedKey);
  });
  const cached = tokenQuoteCache.get(key);
  if (cached) return cached.quote;
  if (tokenQuoteRequests.has(key)) return tokenQuoteRequests.get(key);
  const request = fetchTokenQuote(address, key).finally(() => tokenQuoteRequests.delete(key));
  tokenQuoteRequests.set(key, request);
  return request;
}

async function fetchTokenQuote(address, key) {
  const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(address)}`, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Token quote request failed: ${response.status}`);
  const pairs = await response.json();
  const matching = Array.isArray(pairs) ? pairs.filter((pair) =>
    String(pair?.baseToken?.address || '').toLowerCase() === key && Number(pair?.priceUsd || 0) > 0
  ) : [];
  matching.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  const pair = matching[0];
  const quote = pair ? {
    priceUsd: Number(pair.priceUsd || 0),
    marketCapUsd: Number(pair.marketCap || pair.fdv || 0),
    liquidityUsd: Number(pair?.liquidity?.usd || 0),
    source: 'DEXSCREENER',
    observedAt: Date.now()
  } : null;
  tokenQuoteCache.set(key, { quote, fetchedAt: Date.now() });
  return quote;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getSolPrice, getTokenQuote, _tokenQuoteCache: tokenQuoteCache };
}
```

- [ ] **Step 4: Run targeted and full verification**

Run:

```powershell
node --test tests/background.test.js
npm.cmd test
npm.cmd run check
npm.cmd run build
```

Expected: all six background tests PASS; the full suite passes with 49 tests; validation and build exit 0.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/background.js tests/background.test.js
git commit -m "perf: coalesce background quote requests"
```

---

### Task 3: Enforce Static Extension Contracts

**Files:**
- Create: `tests/validate-extension.test.js`
- Modify: `scripts/validate-extension.js:1-35`

**Interfaces:**
- Consumes: repository root path, package/manifest/constants data, content-script arrays, and `{ file, source }` JavaScript records.
- Produces: `validateExtension(root)`, `versionConsistencyErrors(input)`, `contentScriptOrderErrors(contentScripts)`, and `javascriptSyntaxErrors(sources)`; CLI success/failure behavior remains compatible.

- [ ] **Step 1: Write failing validator tests**

Create `tests/validate-extension.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  validateExtension,
  versionConsistencyErrors,
  contentScriptOrderErrors,
  javascriptSyntaxErrors,
  REQUIRED_ISOLATED_ORDER
} = require('../scripts/validate-extension.js');

test('the current extension satisfies all static contracts', () => {
  const result = validateExtension(path.resolve(__dirname, '..'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.manifest.version, '0.2.17');
});

test('version consistency reports a mismatch', () => {
  const errors = versionConsistencyErrors({
    packageVersion: '0.2.17',
    manifestVersion: '0.2.18',
    constantsSource: "Tango.VERSION = '0.2.17';"
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Version mismatch/);
});

test('content script order reports a swapped marker dependency', () => {
  const scripts = [...REQUIRED_ISOLATED_ORDER];
  const markerIndex = scripts.indexOf('src/content/markers.js');
  [scripts[markerIndex], scripts[markerIndex + 1]] = [scripts[markerIndex + 1], scripts[markerIndex]];
  const errors = contentScriptOrderErrors([{ js: scripts }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /dependency order/);
});

test('JavaScript syntax validation reports the exact broken file', () => {
  const errors = javascriptSyntaxErrors([
    { file: 'valid.js', source: 'const value = 1;' },
    { file: 'broken.js', source: 'function {' }
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /broken\.js/);
});
```

- [ ] **Step 2: Run the validator tests and verify the RED state**

Run:

```powershell
node --test tests/validate-extension.test.js
```

Expected: FAIL because the current CLI-only script does not export the required functions or enforce the new contracts.

- [ ] **Step 3: Replace the validator with callable, testable validation functions**

Replace `scripts/validate-extension.js` with:

```js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REQUIRED_ISOLATED_ORDER = [
  'src/shared/constants.js',
  'src/shared/i18n.js',
  'src/shared/format.js',
  'src/core/engine.js',
  'src/core/storage.js',
  'src/adapters/gmgn.js',
  'src/content/markers.js',
  'src/content/content.js'
];

function versionConsistencyErrors({ packageVersion, manifestVersion, constantsSource }) {
  const constantsVersion = String(constantsSource || '').match(/Tango\.VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
  const versions = [packageVersion, manifestVersion, constantsVersion];
  return versions.every((version) => version && version === versions[0])
    ? []
    : [`Version mismatch: package=${packageVersion || 'missing'}, manifest=${manifestVersion || 'missing'}, constants=${constantsVersion || 'missing'}`];
}

function contentScriptOrderErrors(contentScripts) {
  const script = (contentScripts || []).find((entry) => entry.js?.includes('src/content/content.js'));
  if (!script) return ['Missing isolated content script entry for src/content/content.js'];
  const missing = REQUIRED_ISOLATED_ORDER.filter((file) => !script.js.includes(file));
  if (missing.length) return [`Missing isolated content script dependencies: ${missing.join(', ')}`];
  const indexes = REQUIRED_ISOLATED_ORDER.map((file) => script.js.indexOf(file));
  const ordered = indexes.every((index, position) => position === 0 || indexes[position - 1] < index);
  return ordered ? [] : [`Invalid isolated content script dependency order: ${REQUIRED_ISOLATED_ORDER.join(' -> ')}`];
}

function javascriptSyntaxErrors(sources) {
  const errors = [];
  for (const { file, source } of sources) {
    try { new vm.Script(source, { filename: file }); }
    catch (error) { errors.push(`Invalid JavaScript ${file}: ${error.message}`); }
  }
  return errors;
}

function collectJavaScriptSources(root) {
  const sources = [];
  for (const directory of ['src', 'tests', 'scripts']) {
    const start = path.join(root, directory);
    if (!fs.existsSync(start)) continue;
    const pending = [start];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (entry.isFile() && entry.name.endsWith('.js')) {
          sources.push({ file: path.relative(root, absolute), source: fs.readFileSync(absolute, 'utf8') });
        }
      }
    }
  }
  return sources;
}

function validateExtension(root = path.resolve(__dirname, '..')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const constantsSource = fs.readFileSync(path.join(root, 'src/shared/constants.js'), 'utf8');
  const referenced = new Set();
  const errors = [];
  const add = (value) => { if (typeof value === 'string') referenced.add(value); };

  add(manifest.action?.default_popup);
  add(manifest.options_page);
  add(manifest.background?.service_worker);
  for (const script of manifest.content_scripts || []) {
    (script.js || []).forEach(add);
    (script.css || []).forEach(add);
  }
  for (const block of manifest.web_accessible_resources || []) (block.resources || []).forEach(add);

  const missing = [...referenced].filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) errors.push(`Missing manifest files: ${missing.join(', ')}`);

  for (const htmlFile of ['dashboard.html', 'popup.html']) {
    const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1]).filter((item) => !item.startsWith('http'));
    const missingAssets = assets.filter((file) => !fs.existsSync(path.join(root, file)));
    if (missingAssets.length) errors.push(`${htmlFile} references missing files: ${missingAssets.join(', ')}`);
  }

  errors.push(...versionConsistencyErrors({
    packageVersion: packageJson.version,
    manifestVersion: manifest.version,
    constantsSource
  }));
  errors.push(...contentScriptOrderErrors(manifest.content_scripts));
  errors.push(...javascriptSyntaxErrors(collectJavaScriptSources(root)));
  return { errors, manifest, referenced };
}

if (require.main === module) {
  const result = validateExtension();
  if (result.errors.length) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  } else {
    console.log(`Manifest ${result.manifest.version} valid; ${result.referenced.size} referenced files found.`);
  }
}

module.exports = {
  REQUIRED_ISOLATED_ORDER,
  validateExtension,
  versionConsistencyErrors,
  contentScriptOrderErrors,
  javascriptSyntaxErrors
};
```

- [ ] **Step 4: Run targeted and full verification**

Run:

```powershell
node --test tests/validate-extension.test.js
npm.cmd test
npm.cmd run check
npm.cmd run build
git diff --check
```

Expected: all four validator tests PASS; the full suite passes with 53 tests; check prints `Manifest 0.2.17 valid; 14 referenced files found.`; build exits 0; `git diff --check` emits no errors.

- [ ] **Step 5: Commit Task 3**

```powershell
git add scripts/validate-extension.js tests/validate-extension.test.js
git commit -m "test: enforce extension static contracts"
```

---

### Task 4: Final Integration Verification and Review

**Files:**
- Review: all files changed by Tasks 1-3
- Verify: `dist/tango-paper-trader` generated output remains ignored and mirrors source

**Interfaces:**
- Consumes: the completed implementation and approved design at `docs/superpowers/specs/2026-07-17-conservative-structure-performance-design.md`.
- Produces: fresh verification evidence and a reviewer assessment with no unaddressed critical or important findings.

- [ ] **Step 1: Run the complete verification suite from a clean process**

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
git diff --check
git status --short
```

Expected: 53 tests pass with zero failures; validation reports version `0.2.17` and 14 referenced files; build exits 0; diff check is empty; status lists only intentional source/test/plan changes or is clean after task commits.

- [ ] **Step 2: Verify deterministic performance properties**

Run:

```powershell
node --test tests/content-structure.test.js tests/background.test.js
```

Expected: the no-frame ordering and one-summary assertions pass; identical concurrent requests produce one fetch; fail-then-retry and expired-cache cleanup pass.

- [ ] **Step 3: Review the final diff against the approved exclusions**

```powershell
git diff HEAD~3 -- src/content/content.js src/content/markers.js src/background.js scripts/validate-extension.js manifest.json tests
git diff HEAD~3 -- src/adapters/gmgn.js src/core/engine.js src/core/storage.js src/content/chart-main.js src/content/page-main.js
```

Expected: the first diff contains only the planned changes; the second diff is empty.

- [ ] **Step 4: Request a final code review**

Dispatch a reviewer with the design document, this plan, the base commit before Task 1, and the final HEAD. Resolve every critical or important finding, rerun the complete verification suite after fixes, and document any rejected feedback with code/test evidence.

- [ ] **Step 5: Confirm the branch is ready for handoff**

```powershell
git log --oneline -5
git status --short --branch
```

Expected: the task commits are present in order and the worktree is clean.
