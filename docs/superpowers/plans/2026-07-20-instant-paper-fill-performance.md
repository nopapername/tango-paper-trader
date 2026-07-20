# Instant Multichain Paper Fill and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every valid paper buy and sell commit immediately on all six registered GMGN chains, use GMGN's best local price/supply/native data, neutrally calibrate provisional positions, and remove click-path waits without adding any real-funds capability.

**Architecture:** Add a dependency-free supply resolver, enrich exact `chain:address` GMGN observations, and make content execution resolve a complete paper quote synchronously from local data. The engine records provenance and performs one economic-neutral calibration when stronger price, native-price, or supply data arrives; network and DOM refresh remain asynchronous and never own an order.

**Tech Stack:** Chrome Extension Manifest V3, dependency-free JavaScript IIFEs with CommonJS test exports, `node:test`, `vm` browser-runtime fixtures, Chrome local storage, GMGN same-origin REST/DOM observations.

## Global Constraints

- Supported chains remain exactly `sol`, `eth`, `bsc`, `base`, `robinhood`, and `xlayer`.
- Cash, positions, history, PnL, header assets, and trading actions remain current-chain-only.
- Normal click/confirmation-to-success feedback target is about 100 ms.
- No click handler may await GMGN, DEX Screener, CoinGecko, polling, or an intentional timer.
- Missing token/native market data must use an explicitly provisional nominal `1 USD` paper quote, not fail or queue.
- Exact GMGN total supply wins; then same-observation market-cap/price inference; then verified chain + launchpad + mode rules.
- Known fallback supplies are Pump.fun standard 1B, Pump.fun Mayhem 2B, Four.meme 1B, Flap 1B, Zora 1B, DYOR 1B, Bow.fun 1B, and Bankr/Clanker 100B.
- Provisional or corrected-supply calibration preserves native cost basis, cash, realized PnL, trade count, and position equity at the correction boundary.
- GMGN's private WebSocket protocol is not an execution dependency; the extension reuses GMGN REST responses and the live DOM that GMGN updates.
- Do not add wallet discovery/connection, private-key access, signatures, approvals, swaps, transaction construction, RPC submission, or broadcast.
- Preserve the user's untracked `docs/superpowers/plans/2026-07-18-gmgn-multichain-paper-trading.md` file.

## File Structure

- Create `src/core/supply.js`: pure launchpad normalization and trusted supply resolution.
- Create `tests/supply.test.js`: exact, ratio-derived, rule-derived, and unresolved supply cases.
- Modify `manifest.json`, `popup.html`, `dashboard.html`, `src/background.js`, and `scripts/validate-extension.js`: load `supply.js` before state/engine/adapters in every runtime.
- Modify `src/adapters/gmgn-quotes.js`: extract and field-wise merge price, market cap, total supply, launchpad, metadata, and native prices.
- Modify `src/content/page-main.js`: passively publish GMGN token/native observations; never create a WebSocket or call a trading API.
- Modify `src/adapters/gmgn.js`: read detail/trench supply and market data once per action; remove market-cap polling.
- Modify `src/core/state.js`: persist provisional provenance and bounded calibration audit events while retaining schema-v2 compatibility.
- Modify `src/core/engine.js`: generic supply-backed market-cap valuation, provisional fills, and economic-neutral calibration.
- Modify `src/core/state-coordinator.js`: pass deterministic coordinator time into quote calibration.
- Modify `src/content/content.js`: synchronous local quote resolution, immediate buy/sell/close-all, background-only refresh, and incremental DOM work.
- Modify `src/dashboard/model.js`: export quote/supply/provisional provenance in current-chain CSV rows.
- Modify focused tests in `tests/gmgn-quotes.test.js`, `tests/page-main.test.js`, `tests/gmgn-adapter.test.js`, `tests/state.test.js`, `tests/engine.test.js`, `tests/state-coordinator.test.js`, `tests/content-runtime.test.js`, `tests/content-structure.test.js`, `tests/dashboard-model.test.js`, and `tests/validate-extension.test.js`.

---

### Task 1: Trusted Supply Resolver and Runtime Wiring

**Files:**
- Create: `src/core/supply.js`
- Create: `tests/supply.test.js`
- Modify: `manifest.json`
- Modify: `popup.html`
- Modify: `dashboard.html`
- Modify: `src/background.js:1-8`
- Modify: `scripts/validate-extension.js:5-34`
- Modify: `tests/validate-extension.test.js`

**Interfaces:**
- Consumes: `Tango.Chains.get(chainId)` and chain/address identity supplied by callers.
- Produces: `Tango.Supply.resolve(observation)`, `Tango.Supply.ruleSupply(chain, launchpad, launchMode)`, `Tango.Supply.isTrustedSource(source)`, and `Tango.Supply.SOURCES`.
- `resolve()` returns `{ totalSupply, source, confidence }` or `null` and never mutates its input.

- [ ] **Step 1: Write failing supply-priority tests**

Create `tests/supply.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
const Supply = require('../src/core/supply.js');

test('exact GMGN supply wins over ratio and launchpad rules', () => {
  assert.deepEqual(Supply.resolve({
    chain: 'sol', launchpad: 'pump.fun', launchMode: 'mayhem',
    totalSupply: 1_234_567_890, priceUsd: 2, marketCapUsd: 4_000_000_000
  }), { totalSupply: 1_234_567_890, source: 'GMGN_EXACT', confidence: 'exact' });
});

test('same-observation market cap and price infer supply before registry fallback', () => {
  assert.deepEqual(Supply.resolve({
    chain: 'base', launchpad: 'clanker', priceUsd: 0.000002, marketCapUsd: 2_000
  }), { totalSupply: 1_000_000_000, source: 'GMGN_RATIO', confidence: 'inferred' });
});

test('launchpad and mode rules distinguish 1B, 2B, and 100B supplies', () => {
  assert.equal(Supply.ruleSupply('sol', 'Pump.fun', 'standard'), 1_000_000_000);
  assert.equal(Supply.ruleSupply('sol', 'Pump.fun', 'Mayhem'), 2_000_000_000);
  assert.equal(Supply.ruleSupply('base', 'Bankr', ''), 100_000_000_000);
  assert.equal(Supply.ruleSupply('robinhood', 'Clanker', ''), 100_000_000_000);
  assert.equal(Supply.ruleSupply('xlayer', 'DYOR', ''), 1_000_000_000);
});

test('unknown launchpads do not synthesize a factual supply', () => {
  assert.equal(Supply.resolve({ chain: 'eth', launchpad: 'unknown.fun' }), null);
  assert.equal(Supply.resolve({ chain: 'eth', marketCapUsd: 1000, priceUsd: 0 }), null);
});
```

- [ ] **Step 2: Run the new tests and verify the module is missing**

Run:

```powershell
node --test tests/supply.test.js
```

Expected: FAIL with `Cannot find module '../src/core/supply.js'`.

- [ ] **Step 3: Implement the pure resolver**

Create `src/core/supply.js` with this public contract:

```js
(function initSupply(global) {
  const Tango = global.Tango = global.Tango || {};
  const SOURCES = Object.freeze({
    EXACT: 'GMGN_EXACT',
    RATIO: 'GMGN_RATIO',
    RULE: 'LAUNCHPAD_RULE',
    LEGACY: 'LEGACY_PUMP_RULE'
  });
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  const clean = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function ruleSupply(chain, launchpad, launchMode) {
    const id = Tango.Chains?.get?.(chain)?.id || '';
    const platform = clean(launchpad);
    const mode = clean(launchMode);
    if (id === 'sol' && ['pump', 'pumpfun'].includes(platform)) {
      return mode.includes('mayhem') ? 2_000_000_000 : 1_000_000_000;
    }
    if (['bankr', 'bankrbot', 'clanker'].includes(platform)
      && ['base', 'robinhood'].includes(id)) return 100_000_000_000;
    const oneBillion = new Set(['fourmeme', 'flap', 'zora', 'zoracoins', 'dyor', 'bow', 'bowfun']);
    return oneBillion.has(platform) ? 1_000_000_000 : 0;
  }

  function resolve(observation = {}) {
    if (positive(observation.totalSupply)) {
      const declared = String(observation.supplySource || observation.totalSupplySource || '');
      const source = Object.values(SOURCES).includes(declared) ? declared : SOURCES.EXACT;
      const confidence = source === SOURCES.EXACT ? 'exact'
        : source === SOURCES.RATIO ? 'inferred'
          : 'fallback';
      return { totalSupply: Number(observation.totalSupply), source, confidence };
    }
    if (positive(observation.marketCapUsd) && positive(observation.priceUsd)) {
      const inferred = Number(observation.marketCapUsd) / Number(observation.priceUsd);
      if (Number.isFinite(inferred) && inferred >= 1_000 && inferred <= 1e18) {
        return { totalSupply: inferred, source: SOURCES.RATIO, confidence: 'inferred' };
      }
    }
    const fallback = ruleSupply(observation.chain, observation.launchpad, observation.launchMode);
    return fallback > 0
      ? { totalSupply: fallback, source: SOURCES.RULE, confidence: 'fallback' }
      : null;
  }

  function isTrustedSource(source) {
    return Object.values(SOURCES).includes(String(source || ''));
  }

  Tango.Supply = { SOURCES, resolve, ruleSupply, isTrustedSource };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Supply;
})(globalThis);
```

- [ ] **Step 4: Wire the dependency into every runtime and validator contract**

Insert `src/core/supply.js` immediately after `src/core/chains.js` in both manifest content-script arrays, `popup.html`, and `dashboard.html`. Insert `'core/supply.js'` after `'core/chains.js'` in `src/background.js`.

Update the validator constants exactly:

```js
const REQUIRED_ISOLATED_ORDER = [
  'src/core/chains.js',
  'src/core/supply.js',
  'src/shared/constants.js',
  'src/core/state.js',
  'src/shared/i18n.js',
  'src/shared/format.js',
  'src/core/engine.js',
  'src/core/state-coordinator.js',
  'src/core/storage.js',
  'src/adapters/gmgn-quotes.js',
  'src/adapters/gmgn.js',
  'src/content/chain-view.js',
  'src/content/markers.js',
  'src/content/content.js'
];
const REQUIRED_MAIN_ORDER = [
  'src/core/chains.js',
  'src/core/supply.js',
  'src/adapters/gmgn-quotes.js',
  'src/content/page-main.js'
];
const REQUIRED_WORKER_IMPORT_ORDER = [
  'core/chains.js',
  'core/supply.js',
  'shared/constants.js',
  'core/state.js',
  'core/engine.js',
  'core/state-coordinator.js'
];
```

Update validator fixtures in `tests/validate-extension.test.js` so expected script sequences include the same new dependency.

- [ ] **Step 5: Run focused tests and static validation**

Run:

```powershell
node --test tests/supply.test.js tests/validate-extension.test.js tests/background.test.js
npm.cmd run check
```

Expected: all focused tests PASS; validation reports the manifest valid with the new dependency present in every required order.

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/core/supply.js tests/supply.test.js manifest.json popup.html dashboard.html src/background.js scripts/validate-extension.js tests/validate-extension.test.js
git commit -m "feat: add trusted token supply resolver"
```

---

### Task 2: Enrich GMGN REST Observations and Native Prices

**Files:**
- Modify: `src/adapters/gmgn-quotes.js`
- Modify: `src/content/page-main.js`
- Modify: `tests/gmgn-quotes.test.js`
- Modify: `tests/page-main.test.js`

**Interfaces:**
- Consumes: arbitrary decoded GMGN JSON plus an explicit request-bound chain and observation timestamp.
- Produces: enriched `GMGNQuotes.extract(payload, chain, observedAt)` observations and `GMGNQuotes.extractNativePrices(payload, observedAt)` entries shaped as `{ symbol, priceUsd, observedAt, source }`.
- Page messages remain passive: `TOKEN_QUOTES` and new `NATIVE_PRICES`; no GMGN request is initiated by `page-main.js`.

- [ ] **Step 1: Add failing extraction and field-age tests**

Append to `tests/gmgn-quotes.test.js`:

```js
test('GMGN full-info fields include supply, launchpad, and launch mode', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({ data: [{
    token_address: address,
    price_usd: '0.000002',
    market_cap: '2000',
    total_supply: '1000000000',
    launchpad: 'Clanker',
    launch_mode: 'standard',
    symbol: 'RIGHT',
    name: 'Right Token',
    logo_url: 'right.png'
  }] }, 'base', 500);
  assert.equal(quote.totalSupply, 1_000_000_000);
  assert.equal(quote.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.equal(quote.launchpad, 'Clanker');
  assert.equal(quote.launchMode, 'standard');
  assert.equal(quote.totalSupplyObservedAt, 500);
});

test('older response fields cannot overwrite newer price, supply, or metadata', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const newer = {
    chain: 'eth', address, priceUsd: 3, totalSupply: 2_000_000_000,
    symbol: 'NEW', observedAt: 300, priceObservedAt: 300,
    totalSupplyObservedAt: 300, metadataObservedAt: 300, source: 'GMGN_NETWORK'
  };
  const older = {
    chain: 'eth', address, priceUsd: 2, totalSupply: 1_000_000_000,
    symbol: 'OLD', observedAt: 100, source: 'GMGN_NETWORK'
  };
  const merged = Quotes.mergeObservation(newer, older);
  assert.equal(merged.priceUsd, 3);
  assert.equal(merged.totalSupply, 2_000_000_000);
  assert.equal(merged.symbol, 'NEW');
});

test('major coin price payloads produce only registered native symbols', () => {
  assert.deepEqual(Quotes.extractNativePrices({ data: [
    { symbol: 'SOL', price: '150' },
    { symbol: 'ETH', price_usd: '3500' },
    { symbol: 'RANDOM', price: '9' }
  ] }, 700), [
    { symbol: 'SOL', priceUsd: 150, observedAt: 700, source: 'GMGN_MAJOR_COIN' },
    { symbol: 'ETH', priceUsd: 3500, observedAt: 700, source: 'GMGN_MAJOR_COIN' }
  ]);
});
```

- [ ] **Step 2: Add failing passive-publication tests**

Extend the page-main fixture's quote stubs to expose `extractNativePrices`. Add:

```js
const nativePublished = [];

// Add beside the existing GMGNQuotes.extract stub in loadPageMain:
extractNativePrices(payload, observedAt) {
  return (payload.data || [])
    .filter((entry) => ['SOL', 'ETH', 'BNB', 'OKB'].includes(entry.symbol))
    .map((entry) => ({
      symbol: entry.symbol,
      priceUsd: Number(entry.price || entry.price_usd),
      observedAt,
      source: 'GMGN_MAJOR_COIN'
    }));
}

// Replace the existing context.postMessage method:
postMessage(message) {
  if (message?.type === 'TOKEN_QUOTES') published.push(...message.quotes);
  if (message?.type === 'NATIVE_PRICES') nativePublished.push(...message.prices);
}

// Replace loadPageMain's return value:
return { context, published, nativePublished, listeners };

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

test('page tap does not create a WebSocket or include GMGN execution endpoints', () => {
  assert.doesNotMatch(source, /new\s+WebSocket\s*\(/);
  assert.doesNotMatch(source, /strategy_order|wallet\/list|swap\/route|sendTransaction|signTransaction/);
});
```

- [ ] **Step 3: Run focused tests and confirm missing fields/messages**

Run:

```powershell
node --test tests/gmgn-quotes.test.js tests/page-main.test.js
```

Expected: FAIL because supply/native extraction and `nativePublished` do not exist.

- [ ] **Step 4: Implement field-wise observation merging**

Add key lists for `total_supply`, `supply`, `launchpad`, `platform`, `launch_mode`, and their camel-case forms. Replace whole-object timestamp behavior with a helper that accepts only a positive/text value whose timestamp is at least the previous field timestamp:

```js
function newerPositive(previous, next, valueField, timeField, fallbackTime) {
  const previousTime = Number(previous?.[timeField] || 0);
  const nextTime = Number(next?.[timeField] || fallbackTime || 0);
  return Number(next?.[valueField]) > 0 && nextTime >= previousTime
    ? { value: Number(next[valueField]), observedAt: nextTime }
    : { value: Number(previous?.[valueField] || 0), observedAt: previousTime };
}

function newerText(previous, next, field, fallbackTime, maxLength) {
  const previousTime = Number(previous?.metadataObservedAt || 0);
  const nextTime = Number(next?.metadataObservedAt || fallbackTime || 0);
  const value = metadataText(next?.[field], maxLength);
  return value && nextTime >= previousTime ? value : metadataText(previous?.[field], maxLength);
}
```

The merged observation must include:

```js
{
  chain,
  address,
  priceUsd,
  marketCapUsd,
  liquidityUsd,
  totalSupply,
  totalSupplySource,
  symbol,
  name,
  logoUrl,
  launchpad,
  launchMode,
  priceObservedAt,
  marketCapObservedAt,
  totalSupplyObservedAt,
  metadataObservedAt,
  observedAt: priceUsd > 0 ? priceObservedAt : marketCapObservedAt,
  source: 'GMGN_NETWORK'
}
```

Implement `extractNativePrices` as a bounded traversal that accepts only the registered native symbols derived from `Tango.Chains.all()` and positive prices.

- [ ] **Step 5: Publish token and native observations from the existing response tap**

Change `inspectPayload` to receive the request URL:

```js
function inspectPayload(payload, chain, url) {
  if (chain) {
    try { publish(Tango.GMGNQuotes.extract(payload, chain, Date.now())); } catch {}
  }
  if (/\/api\/v1\/major_coin_prices(?:\?|$)/i.test(String(url || ''))) {
    try {
      const prices = Tango.GMGNQuotes.extractNativePrices(payload, Date.now());
      if (prices.length) window.postMessage({
        source: 'TANGO_GMGN_PAGE', type: 'NATIVE_PRICES', prices
      }, '*');
    } catch {}
  }
}
```

Pass the response URL from both fetch and XHR paths. Remove `swap` from `shouldInspectResponse`; keep token, rank, launchpad, pump, trench, pool, market, quote, price, and new-token paths.

- [ ] **Step 6: Run focused tests**

```powershell
node --test tests/gmgn-quotes.test.js tests/page-main.test.js
```

Expected: all GMGN quote and page-main tests PASS; no active request or WebSocket constructor is added.

- [ ] **Step 7: Commit Task 2**

```powershell
git add src/adapters/gmgn-quotes.js src/content/page-main.js tests/gmgn-quotes.test.js tests/page-main.test.js
git commit -m "feat: capture richer GMGN market observations"
```

---

### Task 3: Immediate GMGN Detail and Trench Snapshots

**Files:**
- Modify: `src/adapters/gmgn.js:349-365,569-579,704-769`
- Modify: `tests/gmgn-adapter.test.js`

**Interfaces:**
- Consumes: verified detail/card DOM scopes and `Tango.Supply.resolve`.
- Produces: detail and quick-buy contexts whose quote may contain `totalSupply`, `supplySource`, `launchpad`, `launchMode`, and a market-cap-derived price.
- Quick-buy dispatch performs no timer or network wait before calling `onQuickBuy(context)`.

- [ ] **Step 1: Add failing detail supply and zero-wait quick-buy tests**

Extend the detail fixture with a `Total Supply`/`总供应量` InfoItem and a launchpad link. Add:

```js
// Add after tests/gmgn-adapter.test.js loads chains:
require('../src/core/supply.js');

// Replace detailDocument's signature:
function detailDocument({
  chain, address, priceUsd, marketCapUsd, liquidityUsd,
  totalSupply = '0', launchpad = '', linked = true
}) {
  // Replace priceView.querySelectorAll's array:
  const priceView = {
    querySelectorAll: () => [
      infoItem('Price', priceUsd), infoItem(null, marketCapUsd),
      infoItem('Liquidity', liquidityUsd), infoItem('Total Supply', totalSupply)
    ]
  };
  // Add the launchpad URL to the existing scoped link arrays:
  const launchpadLink = {
    href: launchpad ? `https://${launchpad.toLowerCase()}.fun/token/${address}` : '',
    getAttribute: () => null
  };
  const scopedLinks = linked ? [link, ...(launchpad ? [launchpadLink] : [])] : [];
  header.querySelectorAll = (selector) => selector.includes('a[href') ? scopedLinks : [];
  bar.querySelectorAll = (selector) => selector.includes('a[href') ? scopedLinks
    : selector === '[data-sentry-component="TokenHeader"]' ? [header] : [];
  return { document, header, bar };
}

test('detail quote reads price, market cap, and exact total supply from one verified scope', async () => {
  const original = { document: global.document, location: global.location };
  const detail = detailDocument({
    chain: 'base', address: EVM_ADDRESS_2, priceUsd: 0.000002,
    marketCapUsd: 2000, liquidityUsd: 500, totalSupply: '1B', launchpad: 'Zora'
  });
  global.document = detail.document;
  global.location = { href: `https://gmgn.ai/base/token/${EVM_ADDRESS_2}`, origin: 'https://gmgn.ai' };
  try {
    const current = await GMGN.readCurrentToken();
    assert.equal(current.quote.totalSupply, 1_000_000_000);
    assert.equal(current.quote.supplySource, 'GMGN_EXACT');
    assert.equal(current.token.launchpad, 'Zora');
  } finally {
    global.document = original.document;
    global.location = original.location;
  }
});

test('trench quick buy snapshots once and dispatches without polling timers', async () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame, timeout: global.setTimeout };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS, marketCap: '$2K' });
  const orders = [];
  let timerCalls = 0;
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  global.setTimeout = () => { timerCalls += 1; return 1; };
  try {
    GMGN.discoverTokenCards((order) => orders.push(order));
    await harness.slot.__tangoQuickBuyHandler();
    assert.equal(timerCalls, 0);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].quote.marketCapUsd, 2_000);
  } finally {
    Object.assign(global, original);
  }
});
```

- [ ] **Step 2: Run the adapter tests and verify the missing supply/timer behavior**

```powershell
node --test tests/gmgn-adapter.test.js
```

Expected: FAIL on missing supply fields and the existing `latestCardMarketCap` timer loop.

- [ ] **Step 3: Add synchronous detail/card market snapshot helpers**

Add helpers with no asynchronous work:

```js
function detailLaunchpad(scope) {
  const hrefs = Array.from(scope?.querySelectorAll?.('a[href]') || []).map((link) => link.href || '');
  const match = hrefs.find((href) => /pump\.fun|four\.meme|flap|zora|bankr|clanker|bow\.fun|dyor|stroid|trench\.today/i.test(href));
  if (!match) return '';
  return match.match(/pump\.fun|four\.meme|flap|zora|bankr|clanker|bow\.fun|dyor|stroid|trench\.today/i)?.[0] || '';
}

function cardMarketSnapshot(card, chain, address, token = {}) {
  const marketCapUsd = cardMarketCap(card?.innerText || card?.textContent || '');
  const supply = Tango.Supply.resolve({
    chain, launchpad: token.launchpad, launchMode: token.launchMode,
    marketCapUsd, priceUsd: 0
  });
  return {
    priceUsd: supply && marketCapUsd > 0 ? marketCapUsd / supply.totalSupply : 0,
    marketCapUsd,
    totalSupply: Number(supply?.totalSupply || 0),
    supplySource: supply?.source || '',
    valuationMode: supply && marketCapUsd > 0 ? 'MARKET_CAP' : 'PRICE',
    priceProvenance: supply && marketCapUsd > 0 ? 'MARKET_CAP_DERIVED' : '',
    source: 'GMGN_TRENCH',
    observedAt: marketCapUsd > 0 ? Date.now() : 0
  };
}
```

Update `detailQuote` to parse `Total Supply`/`总供应量`, call `Tango.Supply.resolve`, and include `marketCapDivisor: totalSupply` only for derived market-cap valuation. Add launchpad/mode to the verified token object.

- [ ] **Step 4: Remove card polling from the click path**

Delete `latestCardMarketCap`. In `handleClick`, after revalidating chain/address/metadata, call `cardMarketSnapshot` once and invoke `onQuickBuy` immediately:

```js
const token = {
  chain, address, symbol: metadata.symbol, name: metadata.name, logoUrl: metadata.logoUrl,
  launchpad: metadata.launchpad || '', launchMode: metadata.launchMode || '',
  metadataVerified: true, metadataSource: 'GMGN_TRENCH'
};
const quote = cardMarketSnapshot(card, chain, address, token);
await onQuickBuy({ token, quote, amountNative: amountSol, amountSol, sourceUrl: href });
```

Keep the existing address and chain rechecks before dispatch. Do not dispatch or click GMGN's original control.

- [ ] **Step 5: Run adapter regression tests**

```powershell
node --test tests/gmgn-adapter.test.js tests/gmgn-quotes.test.js
```

Expected: all tests PASS; quick-buy tests cover all six chains and no timer is scheduled inside the action handler.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/adapters/gmgn.js tests/gmgn-adapter.test.js
git commit -m "perf: snapshot GMGN quick buys synchronously"
```

---

### Task 4: Persist Quote Provenance and Calibration Audit Events

**Files:**
- Modify: `src/core/state.js`
- Modify: `src/dashboard/model.js`
- Modify: `tests/state.test.js`
- Modify: `tests/dashboard-model.test.js`

**Interfaces:**
- Consumes: legacy/current schema-v2 positions and trades.
- Produces: normalized optional provisional/supply fields plus top-level bounded `calibrations`.
- Calibration event shape: `{ id, chain, tokenAddress, reason, fromPriceUsd, toPriceUsd, fromNativePriceUsd, toNativePriceUsd, fromSupply, toSupply, quantityBefore, quantityAfter, costBasisNative, createdAt }`.

- [ ] **Step 1: Add failing normalization and reset tests**

Add to `tests/state.test.js`:

```js
// Add after tests/state.test.js loads chains and before it loads state:
require('../src/core/supply.js');

test('schema v2 preserves provisional supply provenance and calibration audit events', () => {
  const state = State.createInitialState({ now: 1 });
  state.initialized = true;
  state.positions[`base:${EVM_ADDRESS}`] = {
    chain: 'base', tokenAddress: EVM_ADDRESS, quantity: 1, costBasisNative: 1,
    realizedPnlNative: 0, averageEntryPriceUsd: 1, averageEntryMarketCap: 0,
    lastPriceUsd: 1, lastMarketCapUsd: 0, lastNativePriceUsd: 1,
    totalSupply: 0, supplySource: '', needsCalibration: true,
    provisionalTokenPrice: true, provisionalNativePrice: true,
    valuationMode: 'PRICE', lastPriceProvenance: 'SYNTHETIC_PRICE',
    averageEntryPriceProvenance: 'SYNTHETIC_PRICE', openedAt: 1, updatedAt: 1
  };
  state.calibrations.push({
    id: 'c1', chain: 'base', tokenAddress: EVM_ADDRESS, reason: 'PRICE_AND_NATIVE',
    fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 1, toNativePriceUsd: 3000,
    fromSupply: 0, toSupply: 1_000_000_000, quantityBefore: 1,
    quantityAfter: 1500, costBasisNative: 1, createdAt: 2
  });
  const normalized = State.normalizeState(state, State.normalizeSettings({}), { strict: true });
  assert.equal(normalized.positions[`base:${EVM_ADDRESS}`].needsCalibration, true);
  assert.equal(normalized.calibrations[0].reason, 'PRICE_AND_NATIVE');
});

test('selected-chain reset removes only that chain calibration events', () => {
  const state = State.createInitialState({ now: 1 });
  state.calibrations = [
    { id: 'eth', chain: 'eth', tokenAddress: EVM_ADDRESS, reason: 'PRICE', fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 1, toNativePriceUsd: 2, fromSupply: 0, toSupply: 0, quantityBefore: 1, quantityAfter: 1, costBasisNative: 1, createdAt: 2 },
    { id: 'base', chain: 'base', tokenAddress: EVM_ADDRESS, reason: 'PRICE', fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 1, toNativePriceUsd: 2, fromSupply: 0, toSupply: 0, quantityBefore: 1, quantityAfter: 1, costBasisNative: 1, createdAt: 2 }
  ];
  assert.deepEqual(State.resetChain(state, 'eth', 10, 3).calibrations.map((item) => item.chain), ['base']);
});
```

- [ ] **Step 2: Add failing CSV provenance test**

Add to `tests/dashboard-model.test.js`:

```js
// Add after tests/dashboard-model.test.js loads chains and before it loads state:
require('../src/core/supply.js');

test('CSV exports paper quote and supply provenance for the selected chain', () => {
  const state = fixture();
  Object.assign(state.trades[0], {
    quoteSource: 'TANGO_SYNTHETIC', paperFallback: true, provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: false,
    totalSupply: 100_000_000_000, supplySource: 'GMGN_EXACT', launchpad: 'Clanker'
  });
  const row = DashboardModel.tradesCsvRows(state, 'eth')[0];
  assert.equal(row.quoteSource, 'TANGO_SYNTHETIC');
  assert.equal(row.provisional, true);
  assert.equal(row.totalSupply, 100_000_000_000);
  assert.equal(row.supplySource, 'GMGN_EXACT');
});
```

- [ ] **Step 3: Run focused tests and confirm strict validation/export failures**

```powershell
node --test tests/state.test.js tests/dashboard-model.test.js
```

Expected: FAIL because `calibrations` and the new provenance fields are not normalized/exported.

- [ ] **Step 4: Extend schema-v2-compatible validation and normalization**

Keep `schemaVersion: 2`; missing optional fields normalize safely. Add `SYNTHETIC_PRICE` to accepted price provenance. Validate optional booleans, bounded text, supply numbers, and trusted supply sources through `Tango.Supply.isTrustedSource`.

Add:

```js
function validateCalibration(event) {
  if (!isRecord(event) || !String(event.id || '').trim()) throw new Error('invalidCalibration');
  const chain = Tango.Chains.get(event.chain);
  if (!chain || !Tango.Chains.validateAddress(chain.id, event.tokenAddress)) throw new Error('invalidCalibration');
  const nonnegative = [
    'fromPriceUsd', 'toPriceUsd', 'fromNativePriceUsd', 'toNativePriceUsd',
    'fromSupply', 'toSupply', 'quantityBefore', 'quantityAfter', 'costBasisNative'
  ];
  if (nonnegative.some((field) => !finiteBetween(event[field], 0, Number.MAX_VALUE))
    || !validTimestamp(event.createdAt)
    || ![
      'PRICE', 'NATIVE', 'SUPPLY', 'PRICE_AND_NATIVE',
      'PRICE_AND_SUPPLY', 'NATIVE_AND_SUPPLY', 'PRICE_NATIVE_AND_SUPPLY'
    ].includes(event.reason)) {
    throw new Error('invalidCalibration');
  }
}
```

`createInitialState` returns `calibrations: []`. `normalizeState` preserves at most `Tango.MAX_TRADES` calibration events, strict-validates each event, and normalizes its address. `resetChain` filters only matching-chain events; `resetAll` naturally starts empty.

Map a legacy trusted Pump market-cap position to `totalSupply: 1_000_000_000` and `supplySource: 'LEGACY_PUMP_RULE'` while retaining existing legacy fields for compatibility.

Add `require('../src/core/supply.js')` immediately after the chain import in `tests/state-coordinator.test.js` as well, because strict coordinator imports now validate supply provenance.

- [ ] **Step 5: Extend current-chain CSV fields**

Append these fields after `priceProvenance` in `tradesCsvRows`:

```js
'quoteSource', 'paperFallback', 'provisional', 'syntheticTokenPrice',
'syntheticNativePrice', 'totalSupply', 'supplySource', 'launchpad', 'launchMode'
```

Keep `sourceUrl` last and keep market-cap-derived synthetic price columns blank as before.

- [ ] **Step 6: Run focused state/dashboard tests**

```powershell
node --test tests/state.test.js tests/dashboard-model.test.js tests/state-coordinator.test.js
```

Expected: all focused tests PASS; existing v1/v2 imports remain economically identical.

- [ ] **Step 7: Commit Task 4**

```powershell
git add src/core/state.js src/dashboard/model.js tests/state.test.js tests/dashboard-model.test.js
git commit -m "feat: persist provisional quote calibration provenance"
```

---

### Task 5: Generic Paper Valuation and Economic-Neutral Calibration

**Files:**
- Modify: `src/core/engine.js`
- Modify: `src/core/state-coordinator.js:120-124`
- Modify: `tests/engine.test.js`
- Modify: `tests/state-coordinator.test.js`

**Interfaces:**
- Consumes: complete positive paper quotes, including provisional flags and optional trusted supply.
- Produces: generic market-cap fills on every chain, preserved provenance on trades/positions, and `updatePositionQuote(state, token, quote, now)` calibration.
- `calibratePosition(state, token, quote, now)` returns the original state when no calibration is required; otherwise returns a cloned state with one bounded audit event.

- [ ] **Step 1: Add failing generic market-cap and synthetic fill tests**

Add to `tests/engine.test.js`:

```js
// Add after the existing chain import and before state/engine imports:
require('../src/core/supply.js');

const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const ethToken = {
  chain: 'eth', address: EVM_ADDRESS, symbol: 'ETHY',
  metadataVerified: true, metadataSource: 'GMGN_NETWORK'
};
const baseToken = {
  chain: 'base', address: EVM_ADDRESS, symbol: 'BANKR', launchpad: 'Clanker',
  metadataVerified: true, metadataSource: 'GMGN_NETWORK'
};
const paperSettings = State.normalizeSettings({
  slippageBps: 0, platformFeeBps: 0,
  chains: {
    eth: { networkFeeNative: 0 },
    base: { networkFeeNative: 0 }
  }
});

test('Base market-cap quote uses its exact 100B supply instead of a fixed 1B divisor', () => {
  const initialState = state();
  const quote = {
    priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
    supplySource: 'GMGN_EXACT', nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const result = Engine.executeBuy(initialState, { token: baseToken, quote, amountNative: 1 }, paperSettings, 1_000);
  assert.equal(result.trade.observedPriceUsd, 0.000002);
  assert.equal(result.position.totalSupply, 100_000_000_000);
  assert.equal(result.position.marketCapDivisor, 100_000_000_000);
});

test('nominal token and native prices create an auditable provisional paper fill', () => {
  const initialState = state();
  const quote = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const result = Engine.executeBuy(initialState, { token: ethToken, quote, amountNative: 1 }, paperSettings, 1_000);
  assert.equal(result.trade.provisional, true);
  assert.equal(result.position.needsCalibration, true);
  assert.equal(result.position.quantity, 1);
});
```

- [ ] **Step 2: Add failing calibration tests**

```js
test('first trusted quote calibrates a synthetic position without creating PnL', () => {
  const bought = Engine.executeBuy(state(), {
    token: ethToken,
    quote: {
      priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'TANGO_SYNTHETIC', provisional: true,
      syntheticTokenPrice: true, syntheticNativePrice: true,
      valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
    }, amountNative: 1
  }, paperSettings, 1_000);
  const calibrated = Engine.updatePositionQuote(bought.state, ethToken, {
    priceUsd: 2, marketCapUsd: 2_000_000_000, totalSupply: 1_000_000_000,
    supplySource: 'GMGN_EXACT', nativePriceUsd: 3_000,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  }, 2_000);
  const position = calibrated.positions[Engine.positionKey('eth', ethToken.address)];
  assert.equal(position.quantity, 1_500);
  assert.equal(position.costBasisNative, 1);
  assert.equal(Engine.markPosition(position).unrealizedPnlNative, 0);
  assert.equal(calibrated.trades.length, 1);
  assert.equal(calibrated.calibrations.length, 1);
  assert.equal(position.needsCalibration, false);
});

test('exact supply correction preserves equity and realized PnL after a partial sell', () => {
  const fallbackQuote = {
    priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
    supplySource: 'LAUNCHPAD_RULE', supplyConfidence: 'fallback',
    nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const bought = Engine.executeBuy(state(), {
    token: baseToken, quote: fallbackQuote, amountNative: 1
  }, paperSettings, 1_000);
  const sold = Engine.executeSell(bought.state, {
    token: baseToken, quote: { ...fallbackQuote, observedAt: 2_000, nativePriceObservedAt: 2_000 }, percent: 50
  }, paperSettings, 2_000);
  const key = Engine.positionKey('base', baseToken.address);
  const beforePosition = sold.state.positions[key];
  const before = Engine.markPosition(beforePosition).valueNative;
  const corrected = Engine.updatePositionQuote(sold.state, baseToken, {
    ...fallbackQuote,
    totalSupply: 200_000_000_000,
    supplySource: 'GMGN_EXACT',
    supplyConfidence: 'exact',
    observedAt: 3_000,
    nativePriceObservedAt: 3_000
  }, 3_000);
  const position = corrected.positions[key];
  assert.ok(Math.abs(Engine.markPosition(position).valueNative - before) < 1e-9);
  assert.equal(position.costBasisNative, beforePosition.costBasisNative);
  assert.equal(position.realizedPnlNative, beforePosition.realizedPnlNative);
  assert.equal(corrected.trades.length, sold.state.trades.length);
});

test('a fully closed provisional position is never reopened by a later quote', () => {
  const synthetic = {
    priceUsd: 1, nativePriceUsd: 1, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_SYNTHETIC', provisional: true,
    syntheticTokenPrice: true, syntheticNativePrice: true,
    valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
  };
  const bought = Engine.executeBuy(state(), {
    token: ethToken, quote: synthetic, amountNative: 1
  }, paperSettings, 1_000);
  const closed = Engine.executeSell(bought.state, {
    token: ethToken,
    quote: { ...synthetic, observedAt: 2_000, nativePriceObservedAt: 2_000 },
    percent: 100
  }, paperSettings, 2_000);
  const realQuote = {
    priceUsd: 2, nativePriceUsd: 3_000, observedAt: 3_000, nativePriceObservedAt: 3_000,
    source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  assert.equal(Engine.updatePositionQuote(closed.state, ethToken, realQuote, 3_000), closed.state);
});
```

- [ ] **Step 3: Run engine tests and confirm generic/provisional failures**

```powershell
node --test tests/engine.test.js
```

Expected: FAIL because market-cap trust is Pump-only, `SYNTHETIC_PRICE` is unsupported, and calibration is absent.

- [ ] **Step 4: Replace Pump-only valuation trust with trusted supply**

Introduce:

```js
function trustedSupply(context) {
  const resolved = Tango.Supply.resolve({
    chain: context?.chain,
    totalSupply: context?.totalSupply || context?.marketCapDivisor,
    marketCapUsd: context?.marketCapUsd,
    priceUsd: context?.priceUsd,
    launchpad: context?.launchpad,
    launchMode: context?.launchMode
  });
  if (!resolved) return null;
  const source = context?.supplySource || resolved.source;
  return Tango.Supply.isTrustedSource(source)
    ? { totalSupply: resolved.totalSupply, source }
    : null;
}
```

`trustedMarketCapQuote` requires a positive market cap and trusted supply for the exact order token/position. `effectiveQuotePrice` uses `marketCapUsd / totalSupply`. Preserve legacy Pump positions through their normalized `LEGACY_PUMP_RULE` supply.

- [ ] **Step 5: Persist provisional and supply provenance during buys/sells**

Add these trade fields from the execution quote:

```js
provisional: order.quote.provisional === true,
syntheticTokenPrice: order.quote.syntheticTokenPrice === true,
syntheticNativePrice: order.quote.syntheticNativePrice === true,
totalSupply: Number(order.quote.totalSupply || order.quote.marketCapDivisor || 0),
supplySource: String(order.quote.supplySource || ''),
launchpad: String(order.token.launchpad || order.quote.launchpad || ''),
launchMode: String(order.token.launchMode || order.quote.launchMode || '')
```

Positions carry the same supply identity plus:

```js
needsCalibration: Boolean(
  order.quote.provisional
  || order.quote.syntheticTokenPrice
  || order.quote.syntheticNativePrice
  || order.quote.supplyConfidence === 'fallback'
),
provisionalTokenPrice: order.quote.syntheticTokenPrice === true,
provisionalNativePrice: order.quote.syntheticNativePrice === true
```

- [ ] **Step 6: Implement neutral calibration**

Add `calibratePosition` and call it from `updatePositionQuote` before normal marking. The core formula is:

```js
const oldMark = markPosition(existing);
const preservedValueNative = Number(oldMark.valueNative);
const newPriceUsd = effectiveQuotePrice(quote, existing, existing);
const newNativePriceUsd = Number(quote.nativePriceUsd || existing.lastNativePriceUsd);
const nextQuantity = preservedValueNative * newNativePriceUsd / newPriceUsd;
const nextAverageEntryPriceUsd = Number(existing.costBasisNative) * newNativePriceUsd / nextQuantity;
```

Require all values to be positive finite. Preserve cost basis, realized PnL, account values, and trades. Clear only provisional dimensions for which the quote supplies a non-synthetic replacement. Append one calibration event with the before/after values and reason; cap events at `Tango.MAX_TRADES`.

Before an additional buy or sell, calibrate the existing position against that order's stronger quote so new user quantity is calculated on the corrected basis.

- [ ] **Step 7: Make coordinator quote updates deterministic**

Change:

```js
result = { state: Tango.Engine.updatePositionQuote(state, command.token, command.quote, now()) };
```

Add a coordinator test asserting that a calibration event uses the coordinator's injected timestamp and increments state revision once.

- [ ] **Step 8: Run engine/coordinator/state tests**

```powershell
node --test tests/engine.test.js tests/state.test.js tests/state-coordinator.test.js
```

Expected: all focused tests PASS, including legacy Pump behavior, generic 1B/2B/100B valuation, partial sell calibration, and full-close no-op.

- [ ] **Step 9: Commit Task 5**

```powershell
git add src/core/engine.js src/core/state-coordinator.js tests/engine.test.js tests/state-coordinator.test.js
git commit -m "feat: calibrate provisional paper positions neutrally"
```

---

### Task 6: Synchronous Local Paper Quote Resolution

**Files:**
- Modify: `src/content/content.js:7-13,121-180,568-737,794-1060,1290-1345`
- Modify: `src/shared/i18n.js`
- Modify: `tests/content-runtime.test.js`
- Modify: `tests/content-structure.test.js`

**Interfaces:**
- Consumes: active route, exact GMGN cache, current candidate, existing position, native cache, and `Tango.Supply.resolve`.
- Produces: synchronous `resolvePaperTradeQuote(token, candidate, { position })` that always returns a complete quote for a valid active-chain identity.
- Background refresh is `refreshPaperQuoteInBackground(token)` and its returned promises are never awaited by an order path.

- [ ] **Step 1: Replace waiting-behavior tests with failing immediate-fill tests**

In `tests/content-runtime.test.js`, replace tests expecting `quoteQueued` with:

```js
// Add after tests/content-runtime.test.js loads chains and before it loads state:
const Supply = require('../src/core/supply.js');

// Add Supply beside Chains and GMGNQuotes in the VM context's Tango object:
Supply,

// Extend loadContent's calls object:
closeAll: 0, closeAllOrders: [],

// Replace the Store.executeCloseAll fixture method:
async executeCloseAll(chain, orders) {
  calls.closeAll += 1;
  calls.closeAllOrders.push({ chain, orders });
  return { state: context.__contentTest.runtime.state, trades: orders.map(() => ({})), failures: [] };
}

test('quick buy with no market data commits immediately with a provisional 1 USD quote', async () => {
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
  assert.equal(loaded.calls.buyOrders[0].quote.priceUsd, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.nativePriceUsd, 1);
  assert.equal(loaded.calls.buyOrders[0].quote.provisional, true);
  assert.equal(loaded.api.runtime.toast.type, 'success');
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
```

- [ ] **Step 2: Add structural no-wait assertions**

Replace pending-intent assertions in `tests/content-structure.test.js` with:

```js
test('paper execution paths contain no quote wait, pending intent, or network await', () => {
  const resolver = between('function resolvePaperTradeQuote(', 'function requireExecutableQuote(');
  const execution = between('async function buy(', 'function showToast(');
  assert.doesNotMatch(resolver, /await|setTimeout|requestWithTimeout|sharedQuoteRequest|waitForGmgnQuote/);
  assert.doesNotMatch(execution, /queuePendingPaperIntent|pendingTradeIntents|quoteQueued/);
  for (const name of ['buy', 'sell', 'sellPosition', 'commitCloseAll', 'sellBreakeven']) {
    assert.match(execution, new RegExp(`resolvePaperTradeQuote\\(`), name);
  }
});
```

- [ ] **Step 3: Run content tests and verify old queue behavior fails**

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: FAIL because quote resolution awaits GMGN/DEX/native requests and creates pending intents.

- [ ] **Step 4: Implement the synchronous resolver**

Remove `runtime.pendingTradeIntents`, `waitForGmgnQuote` from execution, `queuePendingPaperIntent`, and `retryPendingPaperIntents`.

Implement:

```js
function resolvePaperTradeQuote(token, candidate, { position = persistedQuoteContext(token) } = {}) {
  const chain = activeChain();
  const address = token?.address || token?.tokenAddress;
  if (!chain || token?.chain !== chain.id || !Tango.Chains.validateAddress(chain.id, address)) return null;
  const normalizedAddress = Tango.Chains.normalizeAddress(chain.id, address);
  const exact = runtime.gmgnQuotes.get(gmgnQuoteKey(chain.id, normalizedAddress)) || null;
  const candidateSource = String(candidate?.source || '').toUpperCase();
  const candidateIsTrusted = candidateSource === 'DEXSCREENER' || candidateSource.startsWith('GMGN');
  const boundCandidate = candidateIsTrusted ? {
    ...(candidate || {}), chain: chain.id, address: normalizedAddress
  } : null;
  const merged = exact && boundCandidate
    ? Tango.GMGNQuotes.mergeObservation(exact, boundCandidate)
    : boundCandidate || exact;
  const local = merged || positionQuote(position) || {};
  const supply = Tango.Supply.resolve({
    chain: chain.id,
    totalSupply: local.totalSupply || position?.totalSupply,
    supplySource: local.supplySource || local.totalSupplySource || position?.supplySource,
    priceUsd: local.priceUsd,
    marketCapUsd: local.marketCapUsd,
    launchpad: token.launchpad || local.launchpad || position?.launchpad,
    launchMode: token.launchMode || local.launchMode || position?.launchMode
  });
  const derivedPrice = !(Number(local.priceUsd) > 0) && Number(local.marketCapUsd) > 0 && supply
    ? Number(local.marketCapUsd) / supply.totalSupply
    : 0;
  const historicalPrice = Number(position?.lastPriceUsd || position?.averageEntryPriceUsd || 0);
  const priceUsd = Number(local.priceUsd || derivedPrice || historicalPrice || 1);
  const native = lastKnownNativeObservation(chain.id, local, position);
  const nativePriceUsd = Number(native.price || 1);
  const now = Date.now();
  const syntheticTokenPrice = !(Number(local.priceUsd) > 0 || derivedPrice > 0 || historicalPrice > 0);
  const syntheticNativePrice = !(native.price > 0);
  return {
    ...local,
    priceUsd,
    nativePriceUsd,
    observedAt: now,
    nativePriceObservedAt: now,
    originalObservedAt: Number(local.observedAt || 0),
    nativeOriginalObservedAt: Number(native.observedAt || 0),
    source: syntheticTokenPrice ? 'TANGO_SYNTHETIC' : String(local.source || 'GMGN_LAST_KNOWN'),
    valuationMode: derivedPrice > 0 ? 'MARKET_CAP' : 'PRICE',
    priceProvenance: syntheticTokenPrice ? 'SYNTHETIC_PRICE'
      : derivedPrice > 0 ? 'MARKET_CAP_DERIVED' : 'OBSERVED_PRICE',
    totalSupply: Number(supply?.totalSupply || 0),
    marketCapDivisor: Number(supply?.totalSupply || 0),
    supplySource: supply?.source || '',
    supplyConfidence: supply?.confidence || '',
    syntheticTokenPrice,
    syntheticNativePrice,
    provisional: syntheticTokenPrice || syntheticNativePrice || supply?.confidence === 'fallback',
    paperFallback: true
  };
}
```

The exact cache key and the bound candidate both use the active normalized identity before `mergeObservation`; Task 2's field timestamps therefore choose the newest positive value deterministically.

- [ ] **Step 5: Make every order path use the local resolver directly**

For buy/sell/sellPosition/breakeven:

```js
order.quote = resolvePaperTradeQuote(order.token, context?.quote, { position });
if (!order.quote) throw new Error('invalidQuote');
refreshPaperQuoteInBackground(order.token);
```

`refreshPaperQuoteInBackground` calls `ensureTokenQuote` and `ensureNativePrice` without awaiting them and attaches `.catch(() => null)` internally. `commitCloseAll` maps positions synchronously to quotes and executes the current-chain orders immediately; it no longer waits on `Promise.all` or queues a retry.

`paperExecutableQuote` restamps an already complete local quote for confirmation callbacks and returns null only for invalid chain/address identity.

- [ ] **Step 6: Handle passive GMGN native price messages**

At the start of `handlePageMessage`, process `NATIVE_PRICES` before the `TOKEN_QUOTES` guard:

```js
if (event.source === window && event.data?.source === 'TANGO_GMGN_PAGE'
  && event.data?.type === 'NATIVE_PRICES') {
  for (const price of event.data.prices || []) {
    Tango.Chains.all().filter((chain) => chain.nativeSymbol === price.symbol)
      .forEach((chain) => rememberNativePrice(chain.id, price.priceUsd, price.observedAt));
  }
  queueRender();
  return;
}
```

This updates Ethereum, Base, and Robinhood independently in runtime maps even when they share the ETH price; accounts and positions remain separate.

- [ ] **Step 7: Add clear provisional UI copy**

Add bilingual `provisionalQuote` text explaining that a temporary paper valuation is in use and will be neutrally calibrated. Display it in confirmation/panel metadata only when `quote.provisional === true`; never label nominal `1 USD` as a live GMGN price.

- [ ] **Step 8: Run focused content tests**

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js tests/engine.test.js
```

Expected: all tests PASS; no `quoteQueued` result occurs; a never-resolving network promise cannot postpone a local fill.

- [ ] **Step 9: Commit Task 6**

```powershell
git add src/content/content.js src/shared/i18n.js tests/content-runtime.test.js tests/content-structure.test.js
git commit -m "fix: commit paper orders from local snapshots"
```

---

### Task 7: Incremental DOM Processing and Measured Click Performance

**Files:**
- Modify: `src/adapters/gmgn.js:663-780`
- Modify: `src/content/content.js:285-310,1570-1600`
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `tests/content-runtime.test.js`
- Modify: `tests/content-structure.test.js`

**Interfaces:**
- Consumes: optional mutation roots passed to `GMGN.discoverTokenCards`.
- Produces: `discoverTokenCards(onQuickBuy, defaultAmount, paperLabel, roots)`; omitted roots retain full reconciliation for startup/route changes.
- Mutation work batches changed roots once; execution performance test measures only local paper work with no external wait.

- [ ] **Step 1: Add failing incremental-discovery test**

Add to `tests/gmgn-adapter.test.js`:

```js
test('incremental discovery scans only supplied mutation roots', () => {
  const original = { document: global.document, location: global.location, raf: global.requestAnimationFrame };
  const harness = quickBuyHarness({ chain: 'base', address: EVM_ADDRESS });
  const originalCardQuery = harness.card.querySelectorAll;
  harness.card.querySelectorAll = (selector) => selector === '.BuyButton-continer'
    ? [harness.slot]
    : originalCardQuery(selector);
  const originalDocumentQuery = harness.document.querySelectorAll;
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.BuyButton-continer') throw new Error('unexpected full document scan');
    return originalDocumentQuery(selector);
  };
  global.document = harness.document;
  global.location = { href: 'https://gmgn.ai/?chain=base', origin: 'https://gmgn.ai' };
  global.requestAnimationFrame = (callback) => callback();
  try {
    assert.equal(GMGN.discoverTokenCards(() => {}, 0.1, 'PAPER', [harness.card]), 1);
    assert.ok(harness.replacement);
  } finally {
    Object.assign(global, original);
  }
});
```

- [ ] **Step 2: Add failing click latency and no-timer test**

Add to `tests/content-runtime.test.js` using `node:perf_hooks`:

```js
test('local quick-buy feedback completes under 100 ms without timer advancement', async () => {
  const loaded = loadContent({ sendMessage: () => new Promise(() => {}) });
  loaded.api.runtime.settings.fastMode = true;
  loaded.api.runtime.settings.confirmationEnabled = false;
  const started = performance.now();
  await loaded.api.handleQuickBuy({
    token: { chain: 'eth', address: ADDRESS_A, symbol: 'FAST', metadataVerified: true, metadataSource: 'GMGN_TRENCH' },
    quote: {}, amountNative: 1
  });
  const elapsed = performance.now() - started;
  assert.equal(loaded.calls.buy, 1);
  assert.ok(elapsed < 100, `expected <100ms, got ${elapsed}ms`);
});
```

Add a structural assertion that the quick-buy handler does not contain `setTimeout`, `waitForGmgnQuote`, or `latestCardMarketCap`.

- [ ] **Step 3: Run focused tests and verify full-scan/latency contracts fail**

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: FAIL because `discoverTokenCards` ignores roots and mutation handling performs whole-document discovery.

- [ ] **Step 4: Add bounded root-based slot discovery**

Implement:

```js
function quickBuySlots(roots) {
  if (!Array.isArray(roots) || !roots.length) {
    return Array.from(document.querySelectorAll('.BuyButton-continer')).slice(0, 80);
  }
  const slots = new Set();
  for (const root of roots.slice(0, 80)) {
    if (root?.matches?.('.BuyButton-continer')) slots.add(root);
    root?.querySelectorAll?.('.BuyButton-continer').forEach((slot) => slots.add(slot));
    const closest = root?.closest?.('.BuyButton-continer');
    if (closest) slots.add(closest);
  }
  return [...slots].slice(0, 80);
}
```

Use these slots in `discoverTokenCards`. Full calls continue restoring overrides no longer present; incremental calls update only affected slots and do not globally restore unrelated cards.

- [ ] **Step 5: Batch mutation roots instead of rescanning the document**

Add `runtime.pendingMutationRoots = new Set()`. In the observer callback, collect `record.target` and element `addedNodes`; schedule one short task. The task snapshots and clears the set, then calls `syncQuickBuyButtons(roots)`. Startup and route changes call `syncQuickBuyButtons()` for one full reconciliation.

Keep the existing `queueRender` animation-frame coalescing and route epoch invalidation. Do not reduce address/chain verification.

- [ ] **Step 6: Run focused and full performance regressions**

```powershell
node --test tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/content-structure.test.js
npm.cmd test
```

Expected: focused tests PASS; full suite has zero failures; the measured local click fixture stays below 100 ms.

- [ ] **Step 7: Commit Task 7**

```powershell
git add src/adapters/gmgn.js src/content/content.js tests/gmgn-adapter.test.js tests/content-runtime.test.js tests/content-structure.test.js
git commit -m "perf: batch GMGN card updates incrementally"
```

---

### Task 8: Safety Regression, Full Verification, and Chrome Build

**Files:**
- Modify: `tests/content-structure.test.js`
- Modify: `tests/validate-extension.test.js`
- Modify: `docs/multichain-smoke-test.md` only with results actually observed during the final smoke test
- Rebuild generated directory: `dist/tango-paper-trader`

**Interfaces:**
- Consumes: completed source and tests from Tasks 1-7.
- Produces: evidence that the package remains paper-only, passes all checks, and matches the rebuilt unpacked Chrome directory.

- [ ] **Step 1: Strengthen failing safety assertions before final verification**

Add exact manifest and source tests:

```js
test('extension permissions and code remain paper-only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../manifest.json'), 'utf8'));
  const pageMain = fs.readFileSync(path.resolve(__dirname, '../src/content/page-main.js'), 'utf8');
  const content = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.permissions.includes('web3'), false);
  assert.doesNotMatch(`${pageMain}\n${content}`,
    /connectWallet|requestSignature|signTransaction|sendTransaction|eth_sendTransaction|wallet_requestPermissions|strategy_order|swap\/route/);
  assert.doesNotMatch(pageMain, /new\s+WebSocket\s*\(/);
});
```

Keep hostname permissions unchanged: GMGN, CoinGecko, and DEX Screener only.

- [ ] **Step 2: Run the complete automated verification**

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
git diff --check
```

Expected: every test passes with zero failures; extension validation exits 0; build reports `dist/tango-paper-trader`; diff check is empty.

- [ ] **Step 3: Verify every packaged file against source**

Run:

```powershell
$root = (Get-Location).Path
$distRoot = Join-Path $root 'dist\tango-paper-trader'
$sourceFiles = @('manifest.json','popup.html','dashboard.html','README.md','PRIVACY.md') +
  (Get-ChildItem (Join-Path $root 'src') -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
$mismatches = foreach ($relative in $sourceFiles) {
  $source = Join-Path $root $relative
  $built = Join-Path $distRoot $relative
  if (!(Test-Path -LiteralPath $built) -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash -ne
    (Get-FileHash -Algorithm SHA256 -LiteralPath $built).Hash) { $relative }
}
if ($mismatches) { throw "Build mismatch: $($mismatches -join ', ')" }
"Verified $($sourceFiles.Count)/$($sourceFiles.Count) packaged files"
```

Expected: the verified count equals the source-file count and no mismatch is reported.

- [ ] **Step 4: Perform a read-only-safe GMGN smoke test**

Load `dist/tango-paper-trader` as an unpacked extension if the browser environment permits it. For every accessible registered chain:

1. Verify the header native balance changes with the GMGN chain.
2. Verify positions/drawer contain only the active chain.
3. Use only Tango's purple PAPER control and Tango's simulated detail panel.
4. Confirm a no-price quick buy succeeds immediately and shows provisional paper wording.
5. Confirm a market-cap/supply card uses the expected 1B, 2B, or 100B divisor.
6. Confirm partial sell and close-all remain current-chain-only.
7. Do not click GMGN's native buy/sell controls, connect a wallet, sign, approve, swap, or submit anything.

Update `docs/multichain-smoke-test.md` only with observed `Pass`, `Fail: reason`, `Unavailable: GMGN component absent`, or `Blocked: environment reason` cells. Do not infer a pass from static tests.

- [ ] **Step 5: Review working tree scope**

```powershell
git status --short
git diff --stat HEAD
```

Expected: only intentional source/test/documentation changes remain. The preserved user file `docs/superpowers/plans/2026-07-18-gmgn-multichain-paper-trading.md` remains untouched and untracked.

- [ ] **Step 6: Commit final verification changes**

```powershell
git add tests/content-structure.test.js tests/validate-extension.test.js docs/multichain-smoke-test.md
git commit -m "test: verify instant paper fill release safety"
```

If `docs/multichain-smoke-test.md` did not change because live loading was blocked, omit it from `git add` and record the blocked environment in the handoff instead.

## Completion Checklist

- [ ] All six chains buy, sell, partially sell, breakeven sell, and close current-chain positions from the same synchronous local resolver.
- [ ] No paper order displays or enters a waiting-for-quote state.
- [ ] GMGN exact supply, ratio supply, and verified launchpad rules resolve in the approved priority.
- [ ] Nominal token/native quotes are visibly provisional and auditably stored.
- [ ] Stronger price/native/supply data calibrates only the remaining position with no artificial PnL.
- [ ] GMGN REST/native observations update caches in the background; private WebSocket protocol remains optional and unused by execution.
- [ ] Metadata, quote, request, position, calibration, and account state remain exact-chain/address isolated.
- [ ] Local click performance fixture completes under 100 ms.
- [ ] Static tests prove no wallet, signing, approval, swap, transaction, or broadcast path was introduced.
- [ ] Full tests, validation, build, package hash comparison, and observed smoke-test reporting are complete before claiming success.
