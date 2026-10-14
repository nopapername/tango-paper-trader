# GMGN Multichain Paper Trading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent paper-trading workspaces for Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer while preserving the existing Solana workflow and exposing only a separate read-only all-chain USD summary.

**Architecture:** Introduce one shared chain registry, a schema-v2 state/migration module, and a native-asset-neutral engine. GMGN, background quotes, content UI, Popup, and Dashboard consume those interfaces; operational views always receive an explicit chain and never combine positions or actions across chains.

**Tech Stack:** Chrome Manifest V3, dependency-free browser IIFEs, `chrome.storage`, Node.js built-in test runner, DOM/VM fixtures, CoinGecko, DEX Screener, GMGN page-response reuse.

## Global Constraints

- Registered chains are exactly `sol`, `eth`, `bsc`, `base`, `robinhood`, and `xlayer` for this release.
- Native assets are SOL, ETH, BNB, ETH, ETH, and OKB respectively; Robinhood Chain uses ETH unless its registry entry is corrected later.
- New accounts start at exactly 10 native units; migrated Solana accounts retain their existing economic state.
- Operational UI and mutations are selected-chain-only; only Popup and Dashboard overview may show a separate read-only all-chain USD summary.
- Buy presets and network fees are per-chain; sell presets, slippage, platform fee, confirmation, fast mode, sound, language, theme, and enablement remain global.
- Fresh GMGN data is primary, verified DEX Screener mappings are fallback, and missing executable quotes fail closed.
- Last-known prices are valuation-only and must never have their timestamps refreshed to create an executable trade.
- Keep the dependency-free IIFE/CommonJS test convention; do not add a framework, package dependency, wallet path, backend, or cloud synchronization.
- Preserve English and Simplified Chinese support and the current extension build/loading model.

---

## File Structure

### New files

- `src/core/chains.js` — canonical chain registry, URL resolution, address validation, and normalization.
- `src/core/state.js` — schema-v2 state creation, settings normalization, v1 migration, and strict import validation.
- `src/adapters/gmgn-quotes.js` — pure chain-bound GMGN response quote extraction used by the MAIN-world tap.
- `src/content/chain-view.js` — pure current-chain selectors and close-order construction.
- `src/popup/model.js` — pure Popup selected-chain and all-chain summary model.
- `src/dashboard/model.js` — pure Dashboard selected-chain filters, calendar values, and CSV rows.
- `tests/chains.test.js` — registry, route, address, and URL construction coverage.
- `tests/state.test.js` — schema creation, migration, import, reset, and settings coverage.
- `tests/gmgn-quotes.test.js` — response extraction and cross-chain binding coverage.
- `tests/chain-view.test.js` — current-chain content selectors and close-all coverage.
- `tests/popup-model.test.js` — Popup isolation and USD summary coverage.
- `tests/dashboard-model.test.js` — Dashboard filtering, calendar, and export coverage.

### Existing files with focused changes

- `src/shared/constants.js` — schema-independent global defaults and compatibility constants.
- `src/shared/format.js` — native-asset amount formatter.
- `src/shared/i18n.js` — multichain and partial-data copy.
- `src/core/engine.js` — native-neutral account and trade calculations.
- `src/core/storage.js` — delegate normalization/migration/import validation to `Tango.State`.
- `src/background.js` — chain-aware native prices and token fallback quotes.
- `src/adapters/gmgn.js` — registry-driven routes, address checks, cards, and metadata.
- `src/content/page-main.js` — use chain-bound quote extraction.
- `src/content/content.js` — active-chain runtime, trading, rendering, and actions.
- `src/content/markers.js` — retain chain-and-address marker isolation and native field compatibility.
- `src/popup/popup.js`, `src/popup/popup.css`, `popup.html` — selected-chain account UI.
- `src/dashboard/dashboard.js`, `src/dashboard/dashboard.css`, `dashboard.html` — selected-chain workspace and global USD overview.
- `manifest.json` — load new dependencies in every required world.
- `scripts/validate-extension.js` — enforce the new dependency order.
- `README.md`, `PRIVACY.md` — supported chains and public quote behavior.
- Existing tests — migrate Solana-specific field assertions and keep regression behavior.

---

### Task 1: Canonical Chain Registry and Script Wiring

**Files:**
- Create: `src/core/chains.js`
- Create: `tests/chains.test.js`
- Modify: `manifest.json:13-50`
- Modify: `popup.html:1-8`
- Modify: `dashboard.html:1-18`
- Modify: `scripts/validate-extension.js:5-14`
- Test: `tests/validate-extension.test.js`

**Interfaces:**
- Produces: `Tango.Chains.all()`, `get(id)`, `require(id)`, `fromUrl(url)`, `validateAddress(chain, address)`, `normalizeAddress(chain, address)`, `tokenUrl(chain, address)`, and `trenchUrl(chain)`.
- Produces registry entries with `id`, `gmgnSlug`, `name`, `nativeSymbol`, `nativePriceKey`, `coingeckoId`, `addressFamily`, `dexScreenerChain`, `wrappedNativeAddress`, `defaultBuyPresets`, `defaultNetworkFeeNative`, and `capabilities`.

- [ ] **Step 1: Write registry tests that define all exact contracts**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Chains = require('../src/core/chains.js');

test('registry exposes the six approved chains once', () => {
  assert.deepEqual(Chains.all().map((chain) => chain.id), ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']);
  assert.deepEqual(Chains.all().map((chain) => chain.nativeSymbol), ['SOL', 'ETH', 'BNB', 'ETH', 'ETH', 'OKB']);
  assert.equal(new Set(Chains.all().map((chain) => chain.gmgnSlug)).size, 6);
});

test('route resolution accepts registered detail and trench URLs only', () => {
  assert.equal(Chains.fromUrl('https://gmgn.ai/eth/token/0x1111111111111111111111111111111111111111').id, 'eth');
  assert.equal(Chains.fromUrl('https://gmgn.ai/?chain=xlayer').id, 'xlayer');
  assert.equal(Chains.fromUrl('https://gmgn.ai/?chain=unknown'), null);
});

test('address validation is family-specific and normalization is deterministic', () => {
  const evm = '0xA111111111111111111111111111111111111111';
  assert.equal(Chains.validateAddress('eth', evm), true);
  assert.equal(Chains.normalizeAddress('base', evm), evm.toLowerCase());
  assert.equal(Chains.validateAddress('sol', evm), false);
  assert.equal(Chains.validateAddress('sol', 'So11111111111111111111111111111111111111112'), true);
});

test('token URLs validate the address before construction', () => {
  assert.equal(
    Chains.tokenUrl('bsc', '0x1111111111111111111111111111111111111111'),
    'https://gmgn.ai/bsc/token/0x1111111111111111111111111111111111111111'
  );
  assert.throws(() => Chains.tokenUrl('bsc', 'not-an-address'), /invalidAddress/);
});
```

- [ ] **Step 2: Run the focused test and verify the expected red state**

Run: `node --test tests/chains.test.js`

Expected: FAIL with `Cannot find module '../src/core/chains.js'`.

- [ ] **Step 3: Implement the complete registry API**

```js
(function initChains(global) {
  const Tango = global.Tango = global.Tango || {};
  const presets = Object.freeze([0.1, 0.2, 0.5, 1, 2, 3, 5, 10]);
  const definitions = [
    ['sol', 'Solana', 'SOL', 'solana', 'solana', 'So11111111111111111111111111111111111111112'],
    ['eth', 'Ethereum', 'ETH', 'ethereum', 'ethereum', ''],
    ['bsc', 'BNB Chain', 'BNB', 'binancecoin', 'bsc', ''],
    ['base', 'Base', 'ETH', 'ethereum', 'base', ''],
    ['robinhood', 'Robinhood Chain', 'ETH', 'ethereum', '', ''],
    ['xlayer', 'X Layer', 'OKB', 'okb', 'xlayer', '']
  ];
  const chains = Object.freeze(definitions.map(([id, name, nativeSymbol, coingeckoId, dexScreenerChain, wrappedNativeAddress]) => Object.freeze({
    id, gmgnSlug: id, name, nativeSymbol, nativePriceKey: coingeckoId, coingeckoId,
    addressFamily: id === 'sol' ? 'SOLANA' : 'EVM',
    dexScreenerChain: dexScreenerChain || null,
    wrappedNativeAddress: wrappedNativeAddress || null,
    defaultBuyPresets: presets,
    defaultNetworkFeeNative: 0.001,
    capabilities: Object.freeze({ detail: true, trench: true, chart: true })
  })));
  const byId = new Map(chains.map((chain) => [chain.id, chain]));
  const get = (id) => byId.get(String(id || '').toLowerCase()) || null;
  const requireChain = (id) => { const chain = get(id); if (!chain) throw new Error('unsupportedChain'); return chain; };
  const normalizeAddress = (chainId, address) => {
    const chain = requireChain(chainId); const value = String(address || '').trim();
    return chain.addressFamily === 'EVM' ? value.toLowerCase() : value;
  };
  const validateAddress = (chainId, address) => {
    const chain = get(chainId); const value = String(address || '').trim();
    if (!chain) return false;
    return chain.addressFamily === 'EVM'
      ? /^0x[a-fA-F0-9]{40}$/.test(value)
      : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  };
  const fromUrl = (value) => {
    let url; try { url = new URL(String(value || '')); } catch { return null; }
    if (url.hostname !== 'gmgn.ai') return null;
    const pathSlug = url.pathname.split('/').filter(Boolean)[0];
    const pathChain = chains.find((chain) => chain.gmgnSlug === String(pathSlug || '').toLowerCase());
    return pathChain || get(url.searchParams.get('chain'));
  };
  const tokenUrl = (chainId, address) => {
    const chain = requireChain(chainId);
    if (!validateAddress(chain.id, address)) throw new Error('invalidAddress');
    return `https://gmgn.ai/${chain.gmgnSlug}/token/${encodeURIComponent(normalizeAddress(chain.id, address))}`;
  };
  const trenchUrl = (chainId) => `https://gmgn.ai/?chain=${encodeURIComponent(requireChain(chainId).gmgnSlug)}`;
  Tango.Chains = { all: () => chains.slice(), get, require: requireChain, fromUrl, normalizeAddress, validateAddress, tokenUrl, trenchUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.Chains;
})(globalThis);
```

- [ ] **Step 4: Wire the registry before every consumer**

In `manifest.json`, prepend `src/core/chains.js` to the MAIN-world page tap and isolated content list:

```json
"js": ["src/core/chains.js", "src/adapters/gmgn-quotes.js", "src/content/page-main.js"]
```

The quote helper does not exist until Task 5, so for this task use `"js": ["src/core/chains.js", "src/content/page-main.js"]`; Task 5 inserts the helper. Add `<script src="src/core/chains.js"></script>` before constants in Popup and Dashboard. Add the registry to `REQUIRED_ISOLATED_ORDER` before constants.

- [ ] **Step 5: Run registry and static validation tests**

Run: `node --test tests/chains.test.js tests/validate-extension.test.js`

Expected: all registry tests and existing validation tests PASS.

- [ ] **Step 6: Commit the registry boundary**

```powershell
git add src/core/chains.js tests/chains.test.js manifest.json popup.html dashboard.html scripts/validate-extension.js tests/validate-extension.test.js
git commit -m "feat: add canonical GMGN chain registry"
```

---

### Task 2: Schema-v2 State, Migration, and Storage

**Files:**
- Create: `src/core/state.js`
- Create: `tests/state.test.js`
- Modify: `src/shared/constants.js:4-52`
- Modify: `src/core/storage.js:20-92`
- Modify: `manifest.json` isolated script order
- Modify: `popup.html`
- Modify: `dashboard.html`
- Modify: `scripts/validate-extension.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `Tango.Chains.all()`, `get()`, `validateAddress()`, and `normalizeAddress()`.
- Produces: `Tango.State.createInitialState({ now, initialBalances })`, `normalizeSettings(raw)`, `normalizeState(raw, settings, options)`, `resetChain(state, chain, balance, now)`, and `resetAll(settings, now)`.
- Preserves `Tango.createInitialState(balance)` as a compatibility alias that creates schema v2 and applies `balance` to Solana while leaving other chains at 10.
- Storage continues producing `{ state, settings }`; all returned state is schema version 2.

- [ ] **Step 1: Add state creation and migration tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/chains.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');

test('new state creates six independent ten-native accounts', () => {
  const state = State.createInitialState({ now: 1000 });
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(Object.keys(state.accounts), ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']);
  Object.values(state.accounts).forEach((account) => {
    assert.equal(account.initialBalanceNative, 10);
    assert.equal(account.cashBalanceNative, 10);
  });
});

test('v1 migration preserves Solana economics and initializes only new chains', () => {
  const address = 'So11111111111111111111111111111111111111112';
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 100, cashBalanceSol: 77, realizedPnlSol: -3, createdAt: 1, updatedAt: 2 },
    positions: { [`sol:${address.toLowerCase()}`]: { chain: 'sol', tokenAddress: address, quantity: 2, costBasisSol: 4, realizedPnlSol: 1 } },
    trades: [{ id: 't1', chain: 'sol', tokenAddress: address, side: 'SELL', amountSol: 2, networkFeeSol: 0.001, realizedPnlSol: 1 }],
    dailyRealized: { '2026-07-18': 1 }, initialized: true
  };
  const state = State.normalizeState(legacy, State.normalizeSettings({ buyPresets: [1], networkFeeSol: 0.002 }));
  assert.equal(state.accounts.sol.cashBalanceNative, 77);
  assert.equal(state.accounts.eth.cashBalanceNative, 10);
  assert.equal(state.positions[`sol:${address.toLowerCase()}`].costBasisNative, 4);
  assert.equal(state.trades[0].amountNative, 2);
  assert.equal(state.dailyRealizedByChain.sol['2026-07-18'].native, 1);
});

test('normalization is idempotent', () => {
  const once = State.normalizeState(State.createInitialState({ now: 1000 }), State.normalizeSettings({}));
  assert.deepEqual(State.normalizeState(once, State.normalizeSettings({})), once);
});

test('selected-chain reset preserves every other chain', () => {
  const state = State.createInitialState({ now: 1000 });
  state.accounts.eth.cashBalanceNative = 4;
  state.accounts.bsc.cashBalanceNative = 7;
  state.positions['eth:0x1111111111111111111111111111111111111111'] = { chain: 'eth', tokenAddress: '0x1111111111111111111111111111111111111111', quantity: 1 };
  const reset = State.resetChain(state, 'eth', 10, 2000);
  assert.equal(reset.accounts.eth.cashBalanceNative, 10);
  assert.equal(reset.accounts.bsc.cashBalanceNative, 7);
  assert.equal(Object.keys(reset.positions).length, 0);
});
```

- [ ] **Step 2: Run state tests and verify the red state**

Run: `node --test tests/state.test.js`

Expected: FAIL because `src/core/state.js` does not exist.

- [ ] **Step 3: Implement state creation and settings normalization**

Use these exact field constructors in `src/core/state.js`:

```js
const accountFor = (balance, now) => ({
  initialBalanceNative: Number(balance), cashBalanceNative: Number(balance), realizedPnlNative: 0,
  createdAt: now, updatedAt: now
});
const chainSettingsFor = (chain, existing = {}) => ({
  buyPresets: Array.isArray(existing.buyPresets) ? existing.buyPresets.map(Number).filter((value) => value > 0).slice(0, 12) : [...chain.defaultBuyPresets],
  networkFeeNative: Number.isFinite(Number(existing.networkFeeNative)) ? Number(existing.networkFeeNative) : chain.defaultNetworkFeeNative,
  initialBalanceNative: Number(existing.initialBalanceNative || 10)
});
```

`createInitialState({ now = Date.now(), initialBalances = {} } = {})` must enumerate `Tango.Chains.all()`, use `initialBalances[chain.id] || 10`, and return empty positions/trades plus one empty daily map per chain.

After assigning `Tango.State`, replace the legacy constructor with:

```js
Tango.createInitialState = (solBalance = 10) => createInitialState({ initialBalances: { sol: Number(solBalance) } });
```

- [ ] **Step 4: Implement explicit v1-to-v2 mapping and strict v2 import checks**

Map legacy fields with nullish checks so zero remains zero:

```js
const native = (object, modern, legacy, fallback = 0) => Number(object?.[modern] ?? object?.[legacy] ?? fallback);
const migrateTrade = (trade) => ({
  ...trade,
  amountNative: native(trade, 'amountNative', 'amountSol'),
  platformFeeNative: native(trade, 'platformFeeNative', 'platformFeeSol'),
  networkFeeNative: native(trade, 'networkFeeNative', 'networkFeeSol'),
  realizedPnlNative: native(trade, 'realizedPnlNative', 'realizedPnlSol'),
  nativePriceUsd: native(trade, 'nativePriceUsd', 'solPriceUsd'),
  nativeSymbol: trade.nativeSymbol || 'SOL'
});
```

Strict import must reject a position when its chain is unknown, its address fails `Tango.Chains.validateAddress`, quantity is negative/non-finite, or the referenced account is absent. It must build the normalized result before `writeRaw` so a thrown error leaves storage unchanged.

- [ ] **Step 5: Delegate storage normalization and resets to `Tango.State`**

Replace local normalization functions with:

```js
const normalizeSettings = (settings) => Tango.State.normalizeSettings(settings);
const normalizeState = (state, settings) => Tango.State.normalizeState(state, settings);
```

Change initialization to `Tango.State.createInitialState()` and add storage methods:

```js
async function resetChain(chain, balanceNative = 10) {
  const { state } = await getAll();
  const next = Tango.State.resetChain(state, chain, balanceNative, Date.now());
  await saveState(next); return next;
}
async function resetAll() {
  const { settings } = await getAll();
  const next = Tango.State.resetAll(settings, Date.now());
  await saveState(next); return next;
}
```

Define initialization as:

```js
async function initialize(defaultBalanceNative = 10, language) {
  const { settings } = await getAll();
  const nextSettings = Tango.State.normalizeSettings({ ...settings, language });
  const initialBalances = Object.fromEntries(Tango.Chains.all().map((chain) => [chain.id, Number(defaultBalanceNative)]));
  const state = Tango.State.createInitialState({ initialBalances });
  state.initialized = true;
  await writeRaw({ [Tango.STORAGE_KEY]: state, [Tango.SETTINGS_KEY]: nextSettings });
  if (!global.chrome?.storage?.local) notify();
  return { state, settings: nextSettings };
}
```

Retain `reset()` as a temporary alias to `resetAll()` until Popup and Dashboard switch in Tasks 7 and 8.

- [ ] **Step 6: Load `state.js` after constants and before engine/storage everywhere**

Update Popup, Dashboard, and isolated content orders to:

```text
src/core/chains.js -> src/shared/constants.js -> src/core/state.js -> shared helpers -> engine -> storage
```

Update static-order validation to enforce that sequence.

- [ ] **Step 7: Run storage and state regression tests**

Run: `node --test tests/state.test.js tests/storage.test.js tests/validate-extension.test.js`

Expected: all tests PASS and storage subscribers still fire exactly once per write.

- [ ] **Step 8: Commit schema-v2 persistence**

```powershell
git add src/core/state.js src/shared/constants.js src/core/storage.js tests/state.test.js tests/storage.test.js manifest.json popup.html dashboard.html scripts/validate-extension.js tests/validate-extension.test.js
git commit -m "feat: add multichain state migration"
```

---

### Task 3: Native-Asset-Neutral Trading Engine

**Files:**
- Modify: `src/core/engine.js:5-337`
- Modify: `tests/engine.test.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes schema-v2 `state.accounts[chain]` and `settings.chainSettings[chain]`.
- Preserves: `executeBuy`, `executeSell`, `executeCloseAll`, `markPosition`, `breakevenSellPercent`, `updatePositionQuote`, and `updatePositionMetadata`.
- Changes: `portfolioSummary(state, chain)` is explicitly chain-local.
- Produces: `globalUsdSummary(state, nativePricesByChain)` returning `{ assetsUsd, pnlUsd, complete, missingChains }`.

- [ ] **Step 1: Convert engine fixtures to schema v2 and add isolation tests**

```js
test('the same EVM address remains isolated across chain accounts', () => {
  const address = '0x1111111111111111111111111111111111111111';
  let state = State.createInitialState({ now: 1 }); state.initialized = true;
  const settings = State.normalizeSettings({});
  const quote = { priceUsd: 2, marketCapUsd: 2_000_000, nativePriceUsd: 2000, observedAt: 1000 };
  state = Engine.executeBuy(state, { token: { chain: 'eth', address, symbol: 'AAA' }, quote, amountNative: 1 }, settings, 1000).state;
  state = Engine.executeBuy(state, { token: { chain: 'base', address, symbol: 'AAA' }, quote, amountNative: 2 }, settings, 1000).state;
  assert.equal(state.accounts.eth.cashBalanceNative, 9);
  assert.equal(state.accounts.base.cashBalanceNative, 8);
  assert.notEqual(state.positions[`eth:${address}`].costBasisNative, state.positions[`base:${address}`].costBasisNative);
});

test('close all only closes orders for the requested chain', () => {
  const result = Engine.executeCloseAll(stateWithEthAndBscPositions, 'eth', ethOrders, settings, 2000);
  assert.equal(Object.values(result.state.positions).some((position) => position.chain === 'eth'), false);
  assert.equal(Object.values(result.state.positions).some((position) => position.chain === 'bsc'), true);
});

test('global USD summary excludes native asset appreciation from paper PnL', () => {
  const state = State.createInitialState({ now: 1 });
  state.accounts.sol.cashBalanceNative = 11;
  state.accounts.eth.cashBalanceNative = 8;
  assert.deepEqual(Engine.globalUsdSummary(state, { sol: 150, eth: 2000, bsc: 0, base: 2000, robinhood: 2000, xlayer: 50 }), {
    assetsUsd: 58150, pnlUsd: -3850, complete: false, missingChains: ['bsc']
  });
});
```

- [ ] **Step 2: Run the engine suite and verify field/API failures**

Run: `node --test tests/engine.test.js`

Expected: FAIL on missing `amountNative`, `accounts`, and `globalUsdSummary` behavior.

- [ ] **Step 3: Generalize quote validation and account/settings resolution**

Add these helpers:

```js
function chainAccount(state, chain) {
  const account = state.accounts?.[chain];
  if (!account) throw new Error('unsupportedChain');
  return account;
}
function tradeSettings(settings, chain) {
  return settings.chainSettings?.[chain] || Tango.State.normalizeSettings(settings).chainSettings[chain];
}
function validateQuote(quote, now = Date.now(), staleMs) {
  if (!quote || !(effectiveQuotePrice(quote) > 0) || !(Number(quote.nativePriceUsd) > 0)) return { ok: false, reason: 'invalidQuote' };
  const maxAge = Number(staleMs || Tango.QUOTE_STALE_MS || 15_000);
  if (!quote.observedAt || now - Number(quote.observedAt) > maxAge) return { ok: false, reason: 'staleQuote' };
  return { ok: true };
}
```

- [ ] **Step 4: Replace Solana-specific arithmetic and fields**

For buy quantity and account mutation use:

```js
const chain = order.token.chain;
const account = chainAccount(state, chain);
const amountNative = Number(order.amountNative);
const networkFeeNative = Number(tradeSettings(settings, chain).networkFeeNative || 0);
const platformFeeNative = feeFor(amountNative, settings);
const netInvestmentNative = amountNative - platformFeeNative - networkFeeNative;
const nativePriceUsd = Number(order.quote.nativePriceUsd);
const quantity = netInvestmentNative * nativePriceUsd / executionPriceUsd;
nextState.accounts[chain].cashBalanceNative = round(account.cashBalanceNative - amountNative);
```

For sells, use these exact calculations and persisted fields:

```js
const executionPriceUsd = effectiveQuotePrice(order.quote, existing) * (1 - slippage);
const nativePriceUsd = Number(order.quote.nativePriceUsd);
const grossProceedsNative = quantity * executionPriceUsd / nativePriceUsd;
const platformFeeNative = feeFor(grossProceedsNative, settings);
const networkFeeNative = Number(tradeSettings(settings, chain).networkFeeNative || 0);
const netProceedsNative = Math.max(0, grossProceedsNative - platformFeeNative - networkFeeNative);
const costShareNative = Number(existing.costBasisNative) * quantity / Number(existing.quantity);
const realizedPnlNative = netProceedsNative - costShareNative;
const realizedPnlUsd = realizedPnlNative * nativePriceUsd;
```

Buy and sell trade records must assign `amountNative`, `platformFeeNative`, `networkFeeNative`, `realizedPnlNative`, `realizedPnlUsd`, `nativePriceUsd`, and `nativeSymbol`. Positions must assign `costBasisNative`, `realizedPnlNative`, `lastNativePriceUsd`, and retain the current price/market-cap fields. Daily values update with:

```js
const day = nextState.dailyRealizedByChain[chain][localDateKey(now)] || { native: 0, usdAtExecution: 0 };
nextState.dailyRealizedByChain[chain][localDateKey(now)] = {
  native: round(day.native + realizedPnlNative),
  usdAtExecution: round(day.usdAtExecution + realizedPnlUsd)
};
```

Replace `markPosition` with the native return contract used by summaries and UI:

```js
function markPosition(position, quote) {
  const priceUsd = quote ? effectiveQuotePrice(quote, position) : Number(position.lastPriceUsd || position.averageEntryPriceUsd || 0);
  const nativePriceUsd = Number(quote?.nativePriceUsd || position.lastNativePriceUsd || 0);
  const valueNative = priceUsd > 0 && nativePriceUsd > 0
    ? Number(position.quantity) * priceUsd / nativePriceUsd
    : Number(position.costBasisNative);
  const unrealizedPnlNative = valueNative - Number(position.costBasisNative);
  const roi = Number(position.costBasisNative) > 0 ? unrealizedPnlNative / Number(position.costBasisNative) * 100 : 0;
  return { valueNative, unrealizedPnlNative, roi, priceUsd, nativePriceUsd };
}
```

`executeCloseAll(state, chain, orders, settings, now)` must reject orders whose `order.token.chain !== chain`, call `executeSell` with 100 percent for matching orders, and return `{ state, trades, failures }` without iterating positions from another chain.

- [ ] **Step 5: Make summary APIs chain-local and add all-chain USD summary**

```js
function portfolioSummary(state, chain) {
  const account = chainAccount(state, chain);
  const positions = Object.values(state.positions || {}).filter((position) => position.chain === chain);
  const trades = (state.trades || []).filter((trade) => trade.chain === chain);
  const marks = positions.map((position) => markPosition(position));
  const positionsValueNative = marks.reduce((sum, mark) => sum + mark.valueNative, 0);
  const unrealizedPnlNative = marks.reduce((sum, mark) => sum + mark.unrealizedPnlNative, 0);
  const equityNative = Number(account.cashBalanceNative) + positionsValueNative;
  const totalPnlNative = equityNative - Number(account.initialBalanceNative);
  const closed = trades.filter((trade) => trade.side === 'SELL');
  const wins = closed.filter((trade) => Number(trade.realizedPnlNative) > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.realizedPnlNative), 0);
  const grossLoss = Math.abs(closed.filter((trade) => Number(trade.realizedPnlNative) < 0).reduce((sum, trade) => sum + Number(trade.realizedPnlNative), 0));
  return {
    cashBalanceNative: Number(account.cashBalanceNative), positionsValueNative, equityNative,
    realizedPnlNative: Number(account.realizedPnlNative || 0), unrealizedPnlNative, totalPnlNative,
    todayPnlNative: Number(state.dailyRealizedByChain?.[chain]?.[localDateKey(Date.now())]?.native || 0),
    positionCount: positions.length, totalTrades: trades.length, closedTrades: closed.length,
    winRate: closed.length ? wins.length / closed.length * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  };
}

function globalUsdSummary(state, nativePricesByChain) {
  let assetsUsd = 0; let pnlUsd = 0; const missingChains = [];
  Tango.Chains.all().forEach((chain) => {
    const price = Number(nativePricesByChain?.[chain.id] || 0);
    if (!(price > 0)) { missingChains.push(chain.id); return; }
    const summary = portfolioSummary(state, chain.id);
    assetsUsd += summary.equityNative * price;
    pnlUsd += summary.totalPnlNative * price;
  });
  return { assetsUsd, pnlUsd, complete: missingChains.length === 0, missingChains };
}
```

- [ ] **Step 6: Run the complete engine and migration suites**

Run: `node --test tests/engine.test.js tests/state.test.js`

Expected: all legacy economic regression cases and new chain-isolation cases PASS.

- [ ] **Step 7: Commit the native-neutral engine**

```powershell
git add src/core/engine.js tests/engine.test.js tests/state.test.js
git commit -m "feat: generalize paper trading engine by chain"
```

---

### Task 4: Multichain Background Quotes

**Files:**
- Modify: `src/background.js:1-121`
- Modify: `tests/background.test.js`

Existing `gmgn.ai`, CoinGecko, and DEX Screener host permissions already cover this task; do not add another host.

**Interfaces:**
- Consumes registry native price and DEX fields.
- Produces `getNativePrice(chain)` and `getTokenQuote(chain, address)`.
- Message contract: `TANGO_GET_NATIVE_PRICE { chain } -> { ok, price }` and existing `TANGO_GET_TOKEN_QUOTE` with chain-aware behavior.
- Preserves `TANGO_GET_SOL_PRICE` as an alias to `getNativePrice('sol')` for one compatibility release.

- [ ] **Step 1: Expand background tests for native assets and cross-chain cache keys**

```js
test('ETH native requests coalesce across Ethereum and Base', async () => {
  const loaded = loadBackground(async () => jsonResponse({ ethereum: { usd: 2500 } }));
  const [eth, base] = await Promise.all([loaded.context.getNativePrice('eth'), loaded.context.getNativePrice('base')]);
  assert.equal(eth, 2500); assert.equal(base, 2500); assert.equal(loaded.fetchCalls.length, 1);
});

test('the same EVM address uses independent DEX requests per chain', async () => {
  const address = '0x1111111111111111111111111111111111111111';
  const loaded = loadBackground(async (url) => jsonResponse([{ baseToken: { address }, priceUsd: url.includes('/base/') ? 2 : 1, liquidity: { usd: 10 } }]));
  const [eth, base] = await Promise.all([loaded.context.getTokenQuote('eth', address), loaded.context.getTokenQuote('base', address)]);
  assert.equal(eth.priceUsd, 1); assert.equal(base.priceUsd, 2); assert.equal(loaded.fetchCalls.length, 2);
});

test('a chain without verified DEX mapping fails closed without fetch', async () => {
  const loaded = loadBackground(async () => { throw new Error('must not fetch'); });
  assert.equal(await loaded.context.getTokenQuote('robinhood', '0x1111111111111111111111111111111111111111'), null);
  assert.equal(loaded.fetchCalls.length, 0);
});
```

- [ ] **Step 2: Run background tests and verify the red state**

Run: `node --test tests/background.test.js`

Expected: FAIL because `getNativePrice` and chain-aware cache keys are absent.

- [ ] **Step 3: Load the registry in service-worker and Node test contexts**

At the top of `background.js`:

```js
if (typeof importScripts === 'function') importScripts('src/core/chains.js');
const Chains = globalThis.Tango?.Chains || (typeof require === 'function' ? require('./core/chains.js') : null);
```

Update the VM test loader to execute `src/core/chains.js` before `src/background.js`, rather than relying on `require` inside the sandbox.

- [ ] **Step 4: Implement native-price cache/coalescing by `nativePriceKey`**

```js
const nativePriceCache = new Map();
const nativePriceRequests = new Map();
async function getNativePrice(chainId) {
  const chain = Chains.get(chainId); if (!chain) throw new Error('unsupportedChain');
  const key = chain.nativePriceKey; const cached = nativePriceCache.get(key);
  if (cached?.price > 0 && Date.now() - cached.fetchedAt < 30_000) return cached.price;
  if (nativePriceRequests.has(key)) return nativePriceRequests.get(key);
  const request = fetchNativePrice(chain, key).finally(() => nativePriceRequests.delete(key));
  nativePriceRequests.set(key, request); return request;
}
```

`fetchNativePrice` requests `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(chain.coingeckoId)}&vs_currencies=usd`. Use the registered wrapped-native DEX fallback only when both wrapped address and DEX mapping exist.

- [ ] **Step 5: Key token caches and endpoints by chain plus normalized address**

```js
const quoteKey = (chain, address) => `${chain.id}:${Chains.normalizeAddress(chain.id, address)}`;
const endpoint = `https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chain.dexScreenerChain)}/${encodeURIComponent(address)}`;
```

Return `null` without fetch when `dexScreenerChain` is absent. Filter pairs by normalized base-token address and keep the highest-liquidity pair.

- [ ] **Step 6: Run all background concurrency and fallback tests**

Run: `node --test tests/background.test.js`

Expected: all existing retry/cache tests plus new multichain tests PASS.

- [ ] **Step 7: Commit multichain quote services**

```powershell
git add src/background.js tests/background.test.js
git commit -m "feat: add multichain native and token quotes"
```

---

### Task 5: Chain-Bound GMGN Response and DOM Adapters

**Files:**
- Create: `src/adapters/gmgn-quotes.js`
- Create: `tests/gmgn-quotes.test.js`
- Modify: `src/content/page-main.js:34-178`
- Modify: `src/adapters/gmgn.js:18-718`
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `manifest.json` MAIN-world and isolated-world order
- Modify: `scripts/validate-extension.js`
- Test: `tests/validate-extension.test.js`

**Interfaces:**
- Produces `Tango.GMGNQuotes.extract(payload, chain, observedAt)` returning chain-bound quotes.
- GMGN adapter consumes `Tango.Chains` and preserves its public DOM methods.
- `readCurrentToken()` returns `{ token: { chain, address, ... }, quote: { nativePriceUsd: 0, ... } }`.

- [ ] **Step 1: Add pure response-extraction tests**

```js
test('EVM quotes bind to one explicit active chain', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const quotes = Quotes.extract({ data: [{ address, price_usd: '2', market_cap: '2000' }] }, 'base', 123);
  assert.deepEqual(quotes, [{ chain: 'base', address: address.toLowerCase(), priceUsd: 2, marketCapUsd: 2000, liquidityUsd: 0, symbol: '', name: '', logoUrl: '', observedAt: 123, source: 'GMGN_NETWORK' }]);
});

test('invalid addresses and unknown chains are discarded', () => {
  assert.deepEqual(Quotes.extract({ address: 'bad', price: 1 }, 'eth', 123), []);
  assert.deepEqual(Quotes.extract({ address: '0x1111111111111111111111111111111111111111', price: 1 }, 'unknown', 123), []);
});
```

- [ ] **Step 2: Run quote extraction tests and verify the red state**

Run: `node --test tests/gmgn-quotes.test.js`

Expected: FAIL because `gmgn-quotes.js` does not exist.

- [ ] **Step 3: Move bounded payload traversal into the pure helper**

Implement the current 8,000-node/500-array/300-object traversal limits, compact-number parsing, metadata limits, and previous-quote merge. Require an explicit registered chain and validate every extracted address with `Tango.Chains.validateAddress(chain, address)`. Normalize the address before returning it.

The exported return shape is exactly:

```js
{ chain, address, priceUsd, marketCapUsd, liquidityUsd, symbol, name, logoUrl, observedAt, source: 'GMGN_NETWORK' }
```

- [ ] **Step 4: Make the MAIN-world tap derive and publish one chain**

In `page-main.js`, replace local extraction with:

```js
function responseChain(url) {
  return Tango.Chains.fromUrl(url)?.id || Tango.Chains.fromUrl(location.href)?.id || null;
}
function inspectPayload(payload, url = location.href) {
  const chain = responseChain(url); if (!chain) return;
  publish(Tango.GMGNQuotes.extract(payload, chain, Date.now()));
}
```

Pass `response.url` and `this.__tangoRequestUrl` from fetch/XHR interception. Cache published quotes by `${quote.chain}:${quote.address}`.

- [ ] **Step 5: Add six-chain adapter route/address tests**

```js
for (const chain of ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']) {
  test(`${chain} detail route is supported`, () => {
    const address = chain === 'sol' ? 'So11111111111111111111111111111111111111112' : '0x1111111111111111111111111111111111111111';
    assert.equal(GMGN._isTokenDetailPage(`https://gmgn.ai/${chain}/token/${address}`), true);
    assert.equal(GMGN.chainFromUrl(`https://gmgn.ai/${chain}/token/${address}`), chain);
  });
}
```

Also assert that Solana cards retain Pump.fun support, EVM cards reject Base58 addresses, and a stale detail header from another chain fails closed.

- [ ] **Step 6: Generalize GMGN DOM methods through the registry**

Replace fixed route regexes and strings with registry checks:

```js
function chainFromUrl(url = location.href) { return Tango.Chains.fromUrl(url)?.id || null; }
function isTokenDetailPage(url = location.href) {
  const chain = Tango.Chains.fromUrl(url); if (!chain) return false;
  const parsed = new URL(url); const parts = parsed.pathname.split('/').filter(Boolean);
  return parts.length === 3 && parts[0] === chain.gmgnSlug && parts[1].toLowerCase() === 'token' && Tango.Chains.validateAddress(chain.id, decodeURIComponent(parts[2]));
}
function isTrenchPage(url = location.href) {
  const parsed = new URL(url); const chain = Tango.Chains.fromUrl(url);
  return parsed.hostname === 'gmgn.ai' && (parsed.pathname === '/' || parsed.pathname === '') && Boolean(chain?.capabilities.trench);
}
```

Use the active chain for card links, visible metadata, quick-buy tokens, and detail reads. Keep Pump.fun branches inside `chain === 'sol'` checks. Set `quote.nativePriceUsd = 0`.

- [ ] **Step 7: Load `chains.js` and `gmgn-quotes.js` before `page-main.js` in MAIN world**

Use this exact order:

```json
["src/core/chains.js", "src/adapters/gmgn-quotes.js", "src/content/page-main.js"]
```

Add `gmgn-quotes.js` before `gmgn.js` in isolated content only if content needs the helper; otherwise do not load it twice. Update static validation for the MAIN-world order.

- [ ] **Step 8: Run GMGN and validation suites**

Run: `node --test tests/gmgn-quotes.test.js tests/gmgn-adapter.test.js tests/validate-extension.test.js`

Expected: all extraction, identity, route, quick-buy, and script-order tests PASS.

- [ ] **Step 9: Commit multichain GMGN adapters**

```powershell
git add src/adapters/gmgn-quotes.js src/content/page-main.js src/adapters/gmgn.js tests/gmgn-quotes.test.js tests/gmgn-adapter.test.js manifest.json scripts/validate-extension.js tests/validate-extension.test.js
git commit -m "feat: bind GMGN adapters to active chain"
```

---

### Task 6: Current-Chain Content Runtime and Page UI

**Files:**
- Create: `src/content/chain-view.js`
- Create: `tests/chain-view.test.js`
- Modify: `src/content/content.js:1-942`
- Modify: `src/content/markers.js:4-38`
- Modify: `src/shared/format.js:18-51`
- Modify: `src/shared/i18n.js:4-115`
- Modify: `src/content/content.css`
- Modify: `manifest.json` isolated script order
- Modify: `scripts/validate-extension.js`
- Test: `tests/content-structure.test.js`
- Test: `tests/markers.test.js`

**Interfaces:**
- Produces `Tango.ChainView.positions(state, chain)`, `trades(state, chain)`, `daily(state, chain)`, and `closeOrders(state, chain, quoteForPosition)`.
- Content resolves `activeChain()` from the current GMGN URL and passes it to every account, position, summary, render, and action method.
- Formatting produces `Tango.Format.native(value, symbol, language, signed)`.

- [ ] **Step 1: Write pure chain-view isolation tests**

```js
test('selectors return only the requested chain', () => {
  const state = {
    positions: { a: { chain: 'eth' }, b: { chain: 'bsc' } },
    trades: [{ chain: 'eth', id: 'e' }, { chain: 'bsc', id: 'b' }],
    dailyRealizedByChain: { eth: { '2026-07-18': { native: 1 } }, bsc: { '2026-07-18': { native: 2 } } }
  };
  assert.deepEqual(View.positions(state, 'eth'), [{ chain: 'eth' }]);
  assert.deepEqual(View.trades(state, 'eth').map((trade) => trade.id), ['e']);
  assert.deepEqual(View.daily(state, 'eth'), { '2026-07-18': { native: 1 } });
});

test('close orders never include another chain and omit stale valuations', () => {
  const orders = View.closeOrders(stateWithEthAndBsc, 'eth', (position) => position.tokenAddress === ETH_ADDRESS ? freshQuote : null);
  assert.deepEqual(orders.map((order) => order.token.chain), ['eth']);
});
```

- [ ] **Step 2: Run chain-view tests and verify the red state**

Run: `node --test tests/chain-view.test.js`

Expected: FAIL because `chain-view.js` does not exist.

- [ ] **Step 3: Implement the chain-view helper**

```js
(function initChainView(global) {
  const Tango = global.Tango = global.Tango || {};
  const positions = (state, chain) => Object.values(state?.positions || {}).filter((position) => position.chain === chain);
  const trades = (state, chain) => (state?.trades || []).filter((trade) => trade.chain === chain);
  const daily = (state, chain) => state?.dailyRealizedByChain?.[chain] || {};
  const closeOrders = (state, chain, quoteForPosition) => positions(state, chain).flatMap((position) => {
    const quote = quoteForPosition(position); if (!quote) return [];
    return [{ token: { chain, address: position.tokenAddress, symbol: position.symbol }, quote }];
  });
  Tango.ChainView = { positions, trades, daily, closeOrders };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tango.ChainView;
})(globalThis);
```

- [ ] **Step 4: Add native formatting and localized multichain errors**

```js
function native(value, symbol, language, signed = false) {
  const numeric = Number(value || 0);
  const sign = signed && numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${number(Math.abs(numeric), language, 4)} ${String(symbol || '').trim()}`.trim();
}
```

Keep `sol()` as `native(value, 'SOL', language, signed)` for legacy callers until Tasks 7 and 8 remove them. Add localized keys for `unsupportedChain`, `invalidAddress`, `nativePriceUnavailable`, `partialUsdData`, and `closeAllPartial`.

- [ ] **Step 5: Make runtime chain and quote state explicit**

Add:

```js
function activeChain() { return Tango.Chains.fromUrl(location.href); }
function activeAccount() { const chain = activeChain(); return chain ? runtime.state.accounts[chain.id] : null; }
function chainSettings() { const chain = activeChain(); return chain ? runtime.settings.chainSettings[chain.id] : null; }
```

At the start of quote ticks and renders, if `activeChain()` is null, clear quick-buy replacements, header summary, shell markup, current token, and modal, then return without reading an account.

Replace `solPriceUsd` with `nativePrices = new Map()`, and request:

```js
chrome.runtime.sendMessage({ type: 'TANGO_GET_NATIVE_PRICE', chain: activeChain().id })
```

Merge quotes into `nativePriceUsd`, key GMGN quotes by `${chain}:${address}`, and remove the `context.token.chain !== 'sol'` rejection.

- [ ] **Step 6: Change trading calls to native fields**

Buy orders use `amountNative`; toasts and confirmations use `Tango.Format.native`. Sell orders resolve the selected chain account through the engine. Do not manufacture a fresh quote from position fields. `sellPosition` must show `staleQuote` when the active fresh quote is absent.

Close all must use:

```js
const chain = activeChain().id;
const orders = Tango.ChainView.closeOrders(runtime.state, chain, (position) => freshExecutableQuote(position));
const result = Tango.Engine.executeCloseAll(runtime.state, chain, orders, runtime.settings);
```

Report `result.failures` plus current-chain positions that had no order.

- [ ] **Step 7: Pass the active chain to every page render**

Use `Tango.Engine.portfolioSummary(runtime.state, activeChain().id)` once per render. Drawer positions come from `Tango.ChainView.positions`. Header balance comes from `activeAccount`. Calendar comes from `Tango.ChainView.daily`. PnL bar, panel totals, presets, fees, and result text use the active chain's native symbol/settings.

The rendered drawer must not contain an all-chain filter or iterate unfiltered `Object.values(runtime.state.positions)`.

- [ ] **Step 8: Keep route changes fail-closed**

When `activeChain()?.id` changes, clear `runtime.current`, GMGN quote context, chart marker signatures, modal state, and quick-buy replacements before the next read. Do not carry a detail context across chain changes even when the address string is identical.

- [ ] **Step 9: Extend structure and marker tests**

Add static assertions that `renderDrawer` calls `Tango.ChainView.positions(runtime.state, activeChain().id)`, `commitCloseAll` passes the chain to `executeCloseAll`, and header summary uses `activeAccount`. Update marker fixtures to use native field names and retain exact chain filtering.

- [ ] **Step 10: Run content, marker, and engine suites**

Run: `node --test tests/chain-view.test.js tests/content-structure.test.js tests/markers.test.js tests/engine.test.js`

Expected: all tests PASS; no other-chain position can appear in a content model or close order.

- [ ] **Step 11: Commit the current-chain page runtime**

```powershell
git add src/content/chain-view.js src/content/content.js src/content/markers.js src/content/content.css src/shared/format.js src/shared/i18n.js tests/chain-view.test.js tests/content-structure.test.js tests/markers.test.js manifest.json scripts/validate-extension.js
git commit -m "feat: isolate GMGN page trading by chain"
```

---

### Task 7: Multichain Popup

**Files:**
- Create: `src/popup/model.js`
- Create: `tests/popup-model.test.js`
- Modify: `src/popup/popup.js:1-88`
- Modify: `src/popup/popup.css`
- Modify: `popup.html`
- Modify: `scripts/validate-extension.js`

**Interfaces:**
- Produces `Tango.PopupModel.build(state, settings, selectedChain, nativePrices)`.
- Popup model returns `{ chain, account, summary, globalUsd, nativeSymbol, chainOptions }`.
- Popup persists selected UI chain as global `settings.selectedChain`.

- [ ] **Step 1: Write Popup model tests**

```js
test('Popup model shows one chain and a separate global USD summary', () => {
  const model = PopupModel.build(stateWithEthAndBsc, settings, 'eth', prices);
  assert.equal(model.chain.id, 'eth');
  assert.equal(model.summary.positionCount, 1);
  assert.equal(model.summary.cashBalanceNative, stateWithEthAndBsc.accounts.eth.cashBalanceNative);
  assert.equal(model.chainPositions.some((position) => position.chain === 'bsc'), false);
  assert.equal(model.globalUsd.assetsUsd > 0, true);
});

test('unknown selected chain falls back to Solana without changing state', () => {
  const model = PopupModel.build(state, settings, 'unknown', prices);
  assert.equal(model.chain.id, 'sol');
});
```

- [ ] **Step 2: Run the Popup model test and verify the red state**

Run: `node --test tests/popup-model.test.js`

Expected: FAIL because `popup/model.js` does not exist.

- [ ] **Step 3: Implement Popup model as a pure composition layer**

```js
function build(state, settings, selectedChain, nativePrices) {
  const chain = Tango.Chains.get(selectedChain) || Tango.Chains.get('sol');
  return {
    chain,
    account: state.accounts[chain.id],
    summary: Tango.Engine.portfolioSummary(state, chain.id),
    chainPositions: Tango.ChainView.positions(state, chain.id),
    globalUsd: Tango.Engine.globalUsdSummary(state, nativePrices),
    nativeSymbol: chain.nativeSymbol,
    chainOptions: Tango.Chains.all().map(({ id, name, nativeSymbol }) => ({ id, name, nativeSymbol }))
  };
}
```

- [ ] **Step 4: Replace onboarding with six-account initialization at 10 native**

Keep language selection. The initialize button calls `Tango.Store.initialize(10, settings.language)` after Task 2 updates that method to create all six accounts. Remove the single Solana balance presets from onboarding because the approved default is exact.

- [ ] **Step 5: Render selected-chain stats and separate global USD cards**

Add `<select id="popup-chain">` from `chainOptions`. Native cards use `Tango.Format.native`. Global cards use `Tango.Format.usd` and display `partialUsdData` when `globalUsd.complete` is false.

On selection, save `{ ...settings, selectedChain: event.target.value }`, rebuild the model, and render. Request native prices for all six chains with `TANGO_GET_NATIVE_PRICE`; background coalescing prevents duplicate ETH fetches.

- [ ] **Step 6: Make reset selected-chain and all-chain actions explicit**

Selected reset calls `Tango.Store.resetChain(model.chain.id, balance)`. All reset calls `Tango.Store.resetAll()` behind the existing permanent-delete warning plus an all-chain label. Both reload state after completion.

- [ ] **Step 7: Load the model before `popup.js` and style the chain/global sections**

Add `<script src="src/popup/model.js"></script>` after storage and before Popup. Add `.chain-selector`, `.global-summary`, and `.partial-data` rules without changing the popup width contract.

- [ ] **Step 8: Run Popup and static validation tests**

Run: `node --test tests/popup-model.test.js tests/validate-extension.test.js`

Expected: all tests PASS and Popup asset references are present.

- [ ] **Step 9: Commit the Popup workspace**

```powershell
git add src/popup/model.js src/popup/popup.js src/popup/popup.css popup.html tests/popup-model.test.js scripts/validate-extension.js
git commit -m "feat: add chain-isolated popup accounts"
```

---

### Task 8: Chain-Selected Dashboard and Exports

**Files:**
- Create: `src/dashboard/model.js`
- Create: `tests/dashboard-model.test.js`
- Modify: `src/dashboard/dashboard.js:1-197`
- Modify: `src/dashboard/dashboard.css`
- Modify: `dashboard.html`
- Modify: `scripts/validate-extension.js`

**Interfaces:**
- Produces `Tango.DashboardModel.build(state, settings, selectedChain, nativePrices, filters)`.
- Produces `tradesCsvRows(state, chain)` and `calendar(state, chain, year, month)` using only the selected chain.
- JSON export remains full-state through `Tango.Store.exportData()`.

- [ ] **Step 1: Write Dashboard isolation and export tests**

```js
test('Dashboard operational collections contain only the selected chain', () => {
  const model = DashboardModel.build(stateWithEthAndBsc, settings, 'bsc', prices, { search: '', side: 'ALL', result: 'ALL', date: '' });
  assert.equal(model.positions.every((position) => position.chain === 'bsc'), true);
  assert.equal(model.trades.every((trade) => trade.chain === 'bsc'), true);
});

test('CSV rows contain only the selected chain and native fields', () => {
  const rows = DashboardModel.tradesCsvRows(stateWithEthAndBsc, 'eth');
  assert.equal(rows.every((row) => row.chain === 'eth'), true);
  assert.deepEqual(Object.keys(rows[0]).includes('nativePriceUsd'), true);
  assert.deepEqual(Object.keys(rows[0]).includes('realizedPnlNative'), true);
});

test('calendar values are selected-chain-only', () => {
  const calendar = DashboardModel.calendar(stateWithEthAndBsc, 'eth', 2026, 6);
  assert.equal(calendar.days['2026-07-18'].native, 1);
  assert.equal(calendar.days['2026-07-18'].usdAtExecution, 2000);
});
```

- [ ] **Step 2: Run Dashboard model tests and verify the red state**

Run: `node --test tests/dashboard-model.test.js`

Expected: FAIL because `dashboard/model.js` does not exist.

- [ ] **Step 3: Implement pure selected-chain Dashboard model**

```js
function build(state, settings, selectedChain, nativePrices, filters) {
  const chain = Tango.Chains.get(selectedChain) || Tango.Chains.get('sol');
  const positions = Tango.ChainView.positions(state, chain.id);
  const trades = Tango.ChainView.trades(state, chain.id).filter((trade) => matchesFilters(trade, filters));
  return {
    chain, positions, trades,
    summary: Tango.Engine.portfolioSummary(state, chain.id),
    globalUsd: Tango.Engine.globalUsdSummary(state, nativePrices),
    chainSettings: settings.chainSettings[chain.id]
  };
}
```

`tradesCsvRows` must map only selected-chain trades and emit `executedAt`, `chain`, `nativeSymbol`, `tokenAddress`, `symbol`, `side`, `amountNative`, `quantity`, `observedPriceUsd`, `executionPriceUsd`, `marketCapUsd`, `nativePriceUsd`, `slippageBps`, `platformFeeNative`, `networkFeeNative`, `realizedPnlNative`, `realizedPnlUsd`, and `sourceUrl`.

- [ ] **Step 4: Add the Dashboard chain selector and model refresh**

Place the selector in the topbar and persist `settings.selectedChain`. Every render rebuilds the model. Positions, History, Calendar, Settings, CSV export, reset, and PNG share `runtime.selectedChain`; none accept `ALL` as a chain value.

- [ ] **Step 5: Render all-chain USD summary only in Overview**

Add two separated cards for total USD assets and paper PnL plus one account card per registry entry. Account cards are read-only navigation: clicking one changes the selected chain and rebuilds the current-chain workspace. If native prices are incomplete, show the localized partial label.

- [ ] **Step 6: Convert every operational panel to selected-chain native units**

Use `Tango.Format.native(value, model.chain.nativeSymbol, lang(), signed)` for balances, cost, value, PnL, fees, and calendar native amounts. Keep token prices and market caps in USD. History and positions receive `model.positions`/`model.trades`, never the raw global collections.

- [ ] **Step 7: Make settings and reset selected-chain-only**

Buy presets and network fee inputs write `runtime.settings.chainSettings[model.chain.id]`. Global controls continue writing their existing top-level settings. Reset calls `Tango.Store.resetChain(model.chain.id, selectedPrincipal)`. Add a separately labeled all-chain reset button calling `resetAll()`.

- [ ] **Step 8: Update exports and result cards**

CSV uses `DashboardModel.tradesCsvRows(state, model.chain.id)`. PNG cards add `${model.chain.name} · ${model.chain.nativeSymbol}` and show realized native PnL plus `realizedPnlUsd`. JSON continues calling `Tango.Store.exportData()` and therefore includes all chains.

- [ ] **Step 9: Load the Dashboard model and add responsive styles**

Add `<script src="src/dashboard/model.js"></script>` after storage and before Dashboard. Add `.chain-select`, `.global-usd-summary`, `.chain-account-grid`, and `.partial-data` rules; keep current desktop sidebar behavior and add wrapping below 900px.

- [ ] **Step 10: Run Dashboard and integration model tests**

Run: `node --test tests/dashboard-model.test.js tests/popup-model.test.js tests/engine.test.js tests/validate-extension.test.js`

Expected: all tests PASS and no operational model exposes a mixed-chain list.

- [ ] **Step 11: Commit the Dashboard workspace**

```powershell
git add src/dashboard/model.js src/dashboard/dashboard.js src/dashboard/dashboard.css dashboard.html tests/dashboard-model.test.js scripts/validate-extension.js
git commit -m "feat: add chain-selected portfolio dashboard"
```

---

### Task 9: End-to-End Contracts, Documentation, and Release Verification

**Files:**
- Modify: `tests/validate-extension.test.js`
- Modify: `tests/content-structure.test.js`
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `manifest.json` version to `0.3.0`
- Modify: `package.json` version to `0.3.0`
- Modify: `src/shared/constants.js` version to `0.3.0`
- Create: `docs/multichain-smoke-test.md`

**Interfaces:**
- Validation enforces complete script order and version consistency.
- Smoke-test document records one row per registered chain and explicit detail/trench/chart results.

- [ ] **Step 1: Add final static contracts before documentation changes**

```js
test('every operational surface is registry and selected-chain driven', () => {
  const content = fs.readFileSync(path.join(root, 'src/content/content.js'), 'utf8');
  const popup = fs.readFileSync(path.join(root, 'src/popup/popup.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'src/dashboard/dashboard.js'), 'utf8');
  assert.match(content, /portfolioSummary\(runtime\.state, activeChain\(\)\.id\)/);
  assert.match(content, /ChainView\.positions\(runtime\.state, activeChain\(\)\.id\)/);
  assert.match(popup, /PopupModel\.build/);
  assert.match(dashboard, /DashboardModel\.build/);
  assert.doesNotMatch(content, /GMGN Solana only in V1/);
});
```

Extend static manifest assertions to require `chains.js`, `state.js`, `chain-view.js`, Popup model, and Dashboard model before their consumers.

- [ ] **Step 2: Run final static contracts and verify any remaining failures**

Run: `node --test tests/validate-extension.test.js tests/content-structure.test.js`

Expected: FAIL only for remaining stale script order, copy, or hard-coded Solana references.

- [ ] **Step 3: Remove stale Solana-only product copy and document exact scope**

README feature text must name all six chains, explain independent native accounts, state the exact 10-native initialization rule, explain that all operations are current-chain-only, and distinguish the read-only global USD summary. Privacy text must disclose public native-price and token-quote requests without implying wallet data.

- [ ] **Step 4: Set the release version consistently**

Set `package.json`, `manifest.json`, and `Tango.VERSION` to exactly `0.3.0`. Run `node --test tests/validate-extension.test.js` and expect version-consistency tests to PASS.

- [ ] **Step 5: Run the full automated verification suite**

Run:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
```

Expected: every test passes, validation reports the current synchronized version and all referenced files, and the unpacked extension builds at `dist/tango-paper-trader`.

- [ ] **Step 6: Verify the generated extension matches source and inspect the worktree**

Run:

```powershell
$root=(Resolve-Path '.').Path
$output=Join-Path $root 'dist\tango-paper-trader'
$files=@('manifest.json','popup.html','dashboard.html','README.md','PRIVACY.md')
$files += Get-ChildItem src -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length+1) }
$mismatch=$files | Where-Object { !(Test-Path (Join-Path $output $_)) -or (Get-FileHash (Join-Path $root $_)).Hash -ne (Get-FileHash (Join-Path $output $_)).Hash }
if ($mismatch) { $mismatch; exit 1 }
git status --short
```

Expected: no mismatched packaged files; status lists only the intended documentation/smoke-test changes before the final commit.

- [ ] **Step 7: Perform and document manual GMGN smoke tests where pages are accessible**

Load `dist/tango-paper-trader` unpacked and test one live token detail page per registered chain. Create `docs/multichain-smoke-test.md` with a table whose columns are `Chain`, `Detail context`, `Buy`, `Partial sell`, `Close all isolation`, `Header asset`, `Drawer isolation`, `Trench`, `Chart`, and `Result`. Each completed cell must contain `Pass`, `Fail: reason`, `Unavailable: GMGN component absent`, or `Blocked: environment reason`; do not create the file with empty status cells. A chain cannot receive overall `Pass` unless detail buy/sell, account isolation, header asset, and drawer isolation pass. Missing Trench or Chart components are capability downgrades and must not trigger a synthetic replacement.

- [ ] **Step 8: Run a final hard-coded-chain audit**

Run:

```powershell
rg -n "GMGN Solana only|/sol/token/|chain !== 'sol'|chain === 'sol'|amountSol|costBasisSol|realizedPnlSol|networkFeeSol|solPriceUsd" src tests README.md PRIVACY.md
```

Expected: matches exist only in explicit v1 migration aliases, Solana/Pump.fun branches, backward-compatibility tests, and the `TANGO_GET_SOL_PRICE` compatibility message. Every remaining match must be explained in the final review notes.

- [ ] **Step 9: Commit integration contracts and documentation**

```powershell
git add tests/validate-extension.test.js tests/content-structure.test.js README.md PRIVACY.md docs/multichain-smoke-test.md manifest.json package.json src/shared/constants.js
git commit -m "docs: document multichain paper trading release"
```

---

## Final Review Checklist

- [ ] Every spec requirement maps to a task above.
- [ ] No operational view can request an `ALL` chain or consume unfiltered global positions/trades.
- [ ] Solana v1 migration preserves account, position, trade, and daily realized economic values.
- [ ] New accounts initialize once at 10 native units.
- [ ] Same-address EVM positions and quote caches remain isolated by chain.
- [ ] Robinhood has no guessed DEX fallback; X Layer uses only its explicit registry mapping.
- [ ] Freshness checks apply to token and native prices before execution.
- [ ] Popup/Dashboard global USD summaries visibly report incomplete price coverage.
- [ ] Existing and new tests, static validation, build, package hash check, and documented smoke tests complete before claiming success.
