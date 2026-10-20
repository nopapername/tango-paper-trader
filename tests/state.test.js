const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');

const PUMP_ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
const VALID_PUMP_ADDRESS = '9cfBkPsoQ2NPHYPi7b69bcQG8FKfNc33k2UfRxiPpump';
const EVM_ADDRESS = '0xa111111111111111111111111111111111111111';
const GLOBAL_BOOLEAN_FIELDS = [
  'enabled', 'fastMode', 'confirmationEnabled', 'soundEnabled', 'showListQuickBuy',
  'barCollapsed', 'panelCollapsed'
];
const GLOBAL_ENUM_FIELDS = ['language', 'displayCurrency', 'theme', 'pnlBarPosition', 'selectedChain'];

function validTrade(overrides = {}) {
  return {
    id: 'trade-1', chain: 'eth', tokenAddress: EVM_ADDRESS, side: 'BUY',
    amountNative: 1, quantity: 100, observedPriceUsd: 20, executionPriceUsd: 20,
    marketCapUsd: 2_000_000, liquidityUsd: 500_000, nativePriceUsd: 2_000,
    nativeSymbol: 'ETH', slippageBps: 0, platformFeeNative: 0,
    networkFeeNative: 0, realizedPnlNative: 0, realizedPnlUsd: 0,
    executedAt: 1_000,
    ...overrides
  };
}

function validPosition(overrides = {}) {
  return {
    chain: 'eth', tokenAddress: EVM_ADDRESS, quantity: 1, costBasisNative: 1,
    realizedPnlNative: 0, averageEntryPriceUsd: 2, averageEntryMarketCap: 2_000_000,
    lastPriceUsd: 2, lastMarketCapUsd: 2_000_000, lastNativePriceUsd: 2_000,
    marketCapDivisor: 1_000_000_000, openedAt: 1, updatedAt: 1,
    ...overrides
  };
}

test('strict state rejects durable observation provenance later than its owning boundary', () => {
  const settings = State.normalizeSettings({});
  for (const field of ['quoteObservedAtOriginal', 'nativePriceObservedAtOriginal']) {
    const value = State.createInitialState({ now: 1 });
    value.trades = [validTrade({ [field]: 1_001 })];
    assert.throws(
      () => State.normalizeState(value, settings, { strict: true }),
      /invalidTrade/,
      field
    );
  }

  const positionState = State.createInitialState({ now: 1 });
  positionState.positions[`eth:${EVM_ADDRESS}`] = validPosition({
    updatedAt: 1_000,
    quoteObservedAt: 1_001
  });
  assert.throws(
    () => State.normalizeState(positionState, settings, { strict: true }),
    /invalidPosition/
  );
});

function unknownFallbackHistoryFixture() {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const token = { chain: 'eth', address: EVM_ADDRESS, symbol: 'FALLBACK' };
  const fallback = global.Tango.Supply.fallbackValuation({
    chain: 'eth', launchpad: 'Unknown'
  });
  const settings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } }
  });
  const quote = {
    ...fallback,
    chain: 'eth', address: EVM_ADDRESS,
    marketCapDivisor: fallback.totalSupply,
    provisionalSupply: fallback.totalSupply,
    nativePriceUsd: 2_000,
    observedAt: 1_000,
    nativePriceObservedAt: 1_000,
    source: 'TANGO_FALLBACK',
    valuationMode: 'MARKET_CAP',
    priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
    syntheticTokenPrice: true,
    provisional: true,
    paperFallback: true
  };
  const bought = Engine.executeBuy(
    initial, { token, quote, amountNative: 1 }, settings, 1_000
  );
  return { token, quote, settings, bought };
}

function launderUnknownFallbackOrigin(state) {
  const laundered = JSON.parse(JSON.stringify(state));
  const origin = laundered.trades.find((trade) => (
    trade.side === 'BUY'
    && trade.supplySource === 'UNKNOWN_FALLBACK'
    && trade.provisionalSupplyProvenance === 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
  ));
  assert.ok(origin);
  assert.equal(origin.paperFallback, true);
  assert.equal(origin.provisional, true);
  assert.equal(origin.syntheticTokenPrice, true);
  Object.assign(origin, {
    marketCapUsd: 1_000_000,
    observedPriceUsd: 0.001,
    executionPriceUsd: 0.001
  });
  return laundered;
}

function validLegacyTrade(overrides = {}) {
  return {
    id: 'legacy-trade-1', chain: 'sol', tokenAddress: PUMP_ADDRESS, side: 'BUY',
    amountSol: 1, quantity: 100, observedPriceUsd: 20, executionPriceUsd: 20,
    marketCapUsd: 2_000_000, liquidityUsd: 500_000, solPriceUsd: 100,
    slippageBps: 0, platformFeeSol: 0, networkFeeSol: 0, realizedPnlSol: 0,
    executedAt: 1_000,
    ...overrides
  };
}

function validLegacyState(overrides = {}) {
  return {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 10, realizedPnlSol: 0, createdAt: 1, updatedAt: 1 },
    positions: {}, trades: [], dailyRealized: {}, initialized: true,
    ...overrides
  };
}

function legacyMarketCapPosition(overrides = {}) {
  return {
    chain: 'sol', tokenAddress: PUMP_ADDRESS, symbol: 'PUMP', quantity: 100_000,
    costBasisSol: 1, realizedPnlSol: 0,
    averageEntryPriceUsd: 0.000003, averageEntryMarketCap: 3_000,
    lastPriceUsd: 0.000003, lastMarketCapUsd: 3_000, lastSolPriceUsd: 100,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
    openedAt: 1, updatedAt: 1,
    ...overrides
  };
}

test('new state creates six independent ten-native accounts', () => {
  const state = State.createInitialState({ now: 1000 });
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(Object.keys(state.accounts), ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']);
  Object.values(state.accounts).forEach((account) => {
    assert.equal(account.initialBalanceNative, 10);
    assert.equal(account.cashBalanceNative, 10);
  });
});

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

test('strict state round-trips only a coherent internal unknown fallback supply identity', () => {
  const state = State.createInitialState({ now: 1 });
  state.initialized = true;
  const key = `eth:${EVM_ADDRESS}`;
  state.positions[key] = {
    chain: 'eth', tokenAddress: EVM_ADDRESS, symbol: 'FALLBACK', name: 'Fallback',
    quantity: 625_000_000, costBasisNative: 1, realizedPnlNative: 0,
    averageEntryPriceUsd: 3_200 / 1_000_000_000,
    averageEntryMarketCap: 3_200,
    lastPriceUsd: 3_200 / 1_000_000_000,
    lastMarketCapUsd: 3_200,
    lastNativePriceUsd: 2_000,
    openedAt: 1_000, updatedAt: 1_000, quoteObservedAt: 1_000,
    valuationMode: 'MARKET_CAP',
    marketCapDivisor: 1_000_000_000,
    totalSupply: 1_000_000_000,
    provisionalSupply: 1_000_000_000,
    provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1',
    supplySource: 'UNKNOWN_FALLBACK',
    lastPriceProvenance: 'SYNTHETIC_PRICE',
    averageEntryPriceProvenance: 'SYNTHETIC_PRICE',
    quoteSource: 'TANGO_FALLBACK',
    paperFallback: true,
    provisional: true,
    syntheticTokenPrice: true,
    syntheticNativePrice: false,
    needsCalibration: true,
    provisionalTokenPrice: true,
    provisionalNativePrice: false
  };
  state.trades = [validTrade({
    id: 'fallback-entry',
    quantity: 625_000_000,
    observedPriceUsd: 3_200 / 1_000_000_000,
    executionPriceUsd: 3_200 / 1_000_000_000,
    marketCapUsd: 3_200,
    valuationMode: 'MARKET_CAP',
    priceProvenance: 'SYNTHETIC_PRICE',
    quoteSource: 'TANGO_FALLBACK',
    paperFallback: true,
    provisional: true,
    syntheticTokenPrice: true,
    syntheticNativePrice: false,
    totalSupply: 1_000_000_000,
    marketCapDivisor: 1_000_000_000,
    provisionalSupply: 1_000_000_000,
    provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1',
    supplySource: 'UNKNOWN_FALLBACK'
  })];

  const normalized = State.normalizeState(state, State.normalizeSettings({}), { strict: true });
  assert.equal(normalized.positions[key].supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(normalized.positions[key].provisionalSupply, 1_000_000_000);
  assert.deepEqual(
    State.normalizeState(normalized, State.normalizeSettings({}), { strict: true }),
    normalized
  );

  for (const patch of [
    { totalSupply: 42 },
    { marketCapDivisor: 42 },
    { provisionalSupply: 42 },
    { provisionalSupplyProvenance: '' }
  ]) {
    const malformed = structuredClone(state);
    Object.assign(malformed.positions[key], patch);
    assert.throws(
      () => State.normalizeState(malformed, State.normalizeSettings({}), { strict: true }),
      /invalidPosition/
    );
  }

  const nonStrictMalformed = structuredClone(state);
  nonStrictMalformed.positions[key].provisionalSupply = 42;
  const sanitized = State.normalizeState(
    nonStrictMalformed, State.normalizeSettings({}), { strict: false }
  );
  assert.notEqual(sanitized.positions[key].supplySource, 'UNKNOWN_FALLBACK');
});

test('strict state accepts only a canonical unknown fallback card-market-cap origin', () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } }
  });
  const fallback = global.Tango.Supply.fallbackValuation({
    chain: 'eth', launchpad: 'Unknown'
  });
  const bought = Engine.executeBuy(initial, {
    token: { chain: 'eth', address: EVM_ADDRESS, symbol: 'CARD' },
    quote: {
      ...fallback,
      chain: 'eth', address: EVM_ADDRESS,
      marketCapUsd: 5_000,
      priceUsd: 5_000 / 1_000_000_000,
      marketCapDivisor: 1_000_000_000,
      provisionalSupply: 1_000_000_000,
      nativePriceUsd: 2_000,
      observedAt: 1_000,
      nativePriceObservedAt: 1_000,
      originalObservedAt: 900,
      source: 'TANGO_FALLBACK_CARD_MARKET_CAP',
      valuationMode: 'MARKET_CAP',
      valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY',
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
      syntheticTokenPrice: true,
      provisional: true,
      paperFallback: true
    },
    amountNative: 1
  }, settings, 1_000);
  const clean = JSON.parse(JSON.stringify(bought.state));
  const origin = clean.trades.find((trade) => trade.side === 'BUY');

  assert.equal(origin.quoteSource, 'TANGO_FALLBACK_CARD_MARKET_CAP');
  assert.equal(origin.quoteObservedAtOriginal, 900);
  assert.doesNotThrow(() => State.normalizeState(clean, settings, { strict: true }));

  for (const [label, patch] of [
    ['forged source', { quoteSource: 'TANGO_FALLBACK' }],
    ['missing source', { quoteSource: '' }],
    ['zero original time', { quoteObservedAtOriginal: 0 }],
    ['future original time', { quoteObservedAtOriginal: 1_001 }],
    ['wrong ratio', { marketCapUsd: 5_100 }],
    ['non-positive market cap', { marketCapUsd: 0 }],
    ['non-positive price', { observedPriceUsd: 0 }]
  ]) {
    const forged = structuredClone(clean);
    Object.assign(forged.trades.find((trade) => trade.side === 'BUY'), patch);
    assert.throws(
      () => State.normalizeState(forged, settings, { strict: true }),
      /invalidTrade/,
      label
    );
  }
});

test('strict state rejects a forged unknown fallback identity without canonical entry provenance', () => {
  const state = State.createInitialState({ now: 1 });
  state.initialized = true;
  const key = `eth:${EVM_ADDRESS}`;
  state.positions[key] = validPosition({
    valuationMode: 'MARKET_CAP',
    totalSupply: 1_000_000_000,
    marketCapDivisor: 1_000_000_000,
    provisionalSupply: 1_000_000_000,
    supplySource: 'UNKNOWN_FALLBACK',
    averageEntryPriceUsd: 3_200 / 1_000_000_000,
    averageEntryMarketCap: 3_200,
    lastPriceUsd: 3_200 / 1_000_000_000,
    lastMarketCapUsd: 3_200,
    quoteSource: 'TANGO_FALLBACK',
    paperFallback: true,
    provisional: true,
    syntheticTokenPrice: true,
    needsCalibration: true,
    provisionalTokenPrice: true
  });
  assert.throws(
    () => State.normalizeState(state, State.normalizeSettings({}), { strict: true }),
    /invalidPosition/
  );
});

test('strict state rejects laundering the canonical fallback entry into an arbitrary one-billion ratio', () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const fallback = global.Tango.Supply.fallbackValuation({
    chain: 'eth', launchpad: 'Unknown'
  });
  const settings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } }
  });
  const bought = Engine.executeBuy(initial, {
    token: { chain: 'eth', address: EVM_ADDRESS, symbol: 'FALLBACK' },
    quote: {
      ...fallback,
      chain: 'eth', address: EVM_ADDRESS,
      marketCapDivisor: fallback.totalSupply,
      provisionalSupply: fallback.totalSupply,
      nativePriceUsd: 2_000,
      observedAt: 1_000,
      nativePriceObservedAt: 1_000,
      source: 'TANGO_FALLBACK',
      valuationMode: 'MARKET_CAP',
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
      syntheticTokenPrice: true,
      provisional: true,
      paperFallback: true
    },
    amountNative: 1
  }, settings, 1_000);
  const laundered = JSON.parse(JSON.stringify(bought.state));
  const key = `eth:${EVM_ADDRESS}`;
  Object.assign(laundered.positions[key], {
    averageEntryMarketCap: 1_000_000,
    averageEntryPriceUsd: 0.001,
    lastMarketCapUsd: 1_000_000,
    lastPriceUsd: 0.001
  });
  const entry = laundered.trades.find((trade) => trade.side === 'BUY');
  Object.assign(entry, {
    marketCapUsd: 1_000_000,
    observedPriceUsd: 0.001,
    executionPriceUsd: 0.001
  });

  assert.equal(
    laundered.positions[key].provisionalSupplyProvenance,
    'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
  );
  assert.equal(
    entry.provisionalSupplyProvenance,
    'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
  );
  assert.throws(
    () => State.normalizeState(laundered, settings, { strict: true }),
    /invalidTrade/
  );
});

test('strict state rejects laundering canonical unknown fallback origin after exact supply correction', () => {
  const { token, settings, bought } = unknownFallbackHistoryFixture();
  const corrected = Engine.updatePositionQuote(bought.state, token, {
    chain: 'eth', address: EVM_ADDRESS,
    priceUsd: 3_200 / 100_000_000_000,
    marketCapUsd: 3_200,
    totalSupply: 100_000_000_000,
    marketCapDivisor: 100_000_000_000,
    supplySource: 'GMGN_EXACT',
    nativePriceUsd: 2_000,
    observedAt: 2_000,
    priceObservedAt: 2_000,
    marketCapObservedAt: 2_000,
    nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK',
    valuationMode: 'MARKET_CAP',
    priceProvenance: 'MARKET_CAP_DERIVED',
    syntheticTokenPrice: false,
    provisional: false,
    paperFallback: false
  }, 2_000);
  const clean = JSON.parse(JSON.stringify(corrected));
  const normalized = State.normalizeState(clean, settings, { strict: true });

  assert.equal(normalized.positions[`eth:${EVM_ADDRESS}`].supplySource, 'GMGN_EXACT');
  assert.deepEqual(
    State.normalizeState(normalized, settings, { strict: true }),
    normalized
  );
  assert.throws(
    () => State.normalizeState(
      launderUnknownFallbackOrigin(corrected), settings, { strict: true }
    ),
    /invalidTrade/
  );
});

test('strict state rejects laundering canonical unknown fallback origin after full close', () => {
  const { token, quote, settings, bought } = unknownFallbackHistoryFixture();
  const closed = Engine.executeSell(bought.state, {
    token,
    quote: {
      ...quote,
      observedAt: 2_000,
      nativePriceObservedAt: 2_000
    },
    percent: 100
  }, settings, 2_000).state;
  const clean = JSON.parse(JSON.stringify(closed));
  const normalized = State.normalizeState(clean, settings, { strict: true });

  assert.equal(normalized.positions[`eth:${EVM_ADDRESS}`], undefined);
  assert.deepEqual(
    State.normalizeState(normalized, settings, { strict: true }),
    normalized
  );
  assert.throws(
    () => State.normalizeState(
      launderUnknownFallbackOrigin(closed), settings, { strict: true }
    ),
    /invalidTrade/
  );
});

test('strict fallback history allows later factual PRICE buys and sells after the canonical origin', () => {
  const { token, settings, bought } = unknownFallbackHistoryFixture();
  const factualPrice = {
    chain: 'eth', address: EVM_ADDRESS,
    priceUsd: 3_200 / 1_000_000_000 * 2,
    nativePriceUsd: 2_000,
    observedAt: 2_000,
    priceObservedAt: 2_000,
    nativePriceObservedAt: 2_000,
    source: 'GMGN_NETWORK',
    valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE',
    syntheticTokenPrice: false,
    provisional: false,
    paperFallback: false
  };
  const sold = Engine.executeSell(bought.state, {
    token,
    quote: {
      ...factualPrice,
      observedAt: 3_000,
      priceObservedAt: 3_000,
      nativePriceObservedAt: 3_000
    },
    percent: 25
  }, settings, 3_000);
  const origin = bought.state.trades.find((trade) => trade.side === 'BUY');
  const factualBuy = {
    ...structuredClone(origin),
    id: 'later-factual-price-buy',
    observedPriceUsd: factualPrice.priceUsd,
    executionPriceUsd: factualPrice.priceUsd,
    marketCapUsd: 0,
    valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE',
    quoteSource: 'GMGN_NETWORK',
    paperFallback: false,
    provisional: false,
    syntheticTokenPrice: false,
    quoteObservedAtOriginal: 2_000,
    nativePriceObservedAtOriginal: 2_000,
    executedAt: 2_000
  };
  const clean = JSON.parse(JSON.stringify({
    ...sold.state,
    trades: [sold.trade, factualBuy, origin]
  }));
  const normalized = State.normalizeState(clean, settings, { strict: true });
  const factualTrades = normalized.trades.filter((trade) => trade.quoteSource === 'GMGN_NETWORK');

  assert.deepEqual(factualTrades.map((trade) => trade.side), ['SELL', 'BUY']);
  assert.ok(factualTrades.every((trade) => trade.valuationMode === 'PRICE'));
  assert.ok(factualTrades.every((trade) => trade.marketCapUsd === 0));
  assert.deepEqual(
    State.normalizeState(normalized, settings, { strict: true }),
    normalized
  );
});

test('settings normalize a durable onboarding initialization marker as a strict boolean', () => {
  assert.equal(State.normalizeSettings({}).onboardingInitialized, false);
  assert.equal(State.normalizeSettings({ onboardingInitialized: true }).onboardingInitialized, true);
  assert.throws(
    () => State.normalizeSettings({ onboardingInitialized: 'true' }, { strict: true }),
    /invalidSettings/
  );
});

test('trusted Base market-cap fills survive strict state roundtrip', () => {
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { base: { networkFeeNative: 0 } }
  });
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const token = {
    chain: 'base', address: EVM_ADDRESS, symbol: 'BANKR', launchpad: 'Clanker',
    metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  };
  const filled = Engine.executeBuy(initial, {
    token,
    quote: {
      priceUsd: 0, marketCapUsd: 200_000, totalSupply: 100_000_000_000,
      supplySource: 'GMGN_EXACT', nativePriceUsd: 2_000,
      observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_NETWORK', valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
    },
    amountNative: 1
  }, settings, 1_000).state;

  const normalized = State.normalizeState(filled, settings, { strict: true });
  const key = Engine.positionKey(token.chain, token.address);
  assert.equal(normalized.positions[key].valuationMode, 'MARKET_CAP');
  assert.equal(normalized.positions[key].totalSupply, 100_000_000_000);
  assert.equal(normalized.positions[key].supplySource, 'GMGN_EXACT');
  assert.equal(normalized.trades[0].priceProvenance, 'MARKET_CAP_DERIVED');
  assert.doesNotThrow(() => State.normalizeState(normalized, settings, { strict: true }));
});

test('strict state rejects unknown supply provenance on market-cap positions and trades', () => {
  const settings = State.normalizeSettings({});
  const positionState = State.createInitialState({ now: 1 });
  positionState.positions[`base:${EVM_ADDRESS}`] = validPosition({
    chain: 'base', tokenAddress: EVM_ADDRESS,
    valuationMode: 'MARKET_CAP', totalSupply: 100_000_000_000,
    marketCapDivisor: 100_000_000_000, supplySource: 'FORGED'
  });
  assert.throws(
    () => State.normalizeState(positionState, settings, { strict: true }),
    /invalidPosition/
  );

  const tradeState = State.createInitialState({ now: 1 });
  tradeState.trades = [validTrade({
    chain: 'base', tokenAddress: EVM_ADDRESS, nativeSymbol: 'ETH',
    valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED',
    totalSupply: 100_000_000_000, supplySource: 'FORGED'
  })];
  assert.throws(
    () => State.normalizeState(tradeState, settings, { strict: true }),
    /invalidTrade/
  );
});

test('strict state binds legacy Pump rule sources to canonical Pump provenance and one-billion supply', () => {
  const settings = State.normalizeSettings({});
  const buildPosition = (position) => {
    const value = State.createInitialState({ now: 1 });
    value.positions = { [`${position.chain}:${position.tokenAddress}`]: position };
    return value;
  };
  const buildTrade = (trade) => {
    const value = State.createInitialState({ now: 1 });
    value.trades = [trade];
    return value;
  };
  const validLegacyPosition = validPosition({
    chain: 'sol', tokenAddress: VALID_PUMP_ADDRESS,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
    totalSupply: 1_000_000_000, supplySource: 'LEGACY_PUMP_RULE',
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1',
    averageEntryPriceUsd: 0.002, averageEntryMarketCap: 2_000_000,
    lastPriceUsd: 0.002, lastMarketCapUsd: 2_000_000
  });
  const validLegacyTrade = validTrade({
    chain: 'sol', tokenAddress: VALID_PUMP_ADDRESS, nativeSymbol: 'SOL',
    valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED',
    totalSupply: 1_000_000_000, supplySource: 'LEGACY_PUMP_RULE',
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1',
    observedPriceUsd: 0.002, executionPriceUsd: 0.002, marketCapUsd: 2_000_000
  });

  assert.doesNotThrow(() => State.normalizeState(buildPosition(validLegacyPosition), settings, { strict: true }));
  assert.doesNotThrow(() => State.normalizeState(buildTrade(validLegacyTrade), settings, { strict: true }));

  const invalidPositions = [
    {
      ...validLegacyPosition, chain: 'base', tokenAddress: EVM_ADDRESS,
      marketCapDivisor: 123, totalSupply: 123, marketCapProvenance: undefined,
      averageEntryPriceUsd: 2, averageEntryMarketCap: 246,
      lastPriceUsd: 2, lastMarketCapUsd: 246
    },
    {
      ...validLegacyPosition, marketCapDivisor: 123, totalSupply: 123,
      averageEntryPriceUsd: 2, averageEntryMarketCap: 246,
      lastPriceUsd: 2, lastMarketCapUsd: 246
    },
    { ...validLegacyPosition, marketCapProvenance: undefined }
  ];
  const invalidTrades = [
    {
      ...validLegacyTrade, chain: 'base', tokenAddress: EVM_ADDRESS, nativeSymbol: 'ETH',
      totalSupply: 123, marketCapProvenance: undefined,
      observedPriceUsd: 2, executionPriceUsd: 2, marketCapUsd: 246
    },
    {
      ...validLegacyTrade, totalSupply: 123,
      observedPriceUsd: 2, executionPriceUsd: 2, marketCapUsd: 246
    },
    { ...validLegacyTrade, marketCapProvenance: undefined }
  ];

  for (const position of invalidPositions) {
    assert.throws(
      () => State.normalizeState(buildPosition(position), settings, { strict: true }),
      /invalidPosition/
    );
  }
  for (const trade of invalidTrades) {
    assert.throws(
      () => State.normalizeState(buildTrade(trade), settings, { strict: true }),
      /invalidTrade/
    );
  }
});

test('strict state binds launchpad rule sources to the contextual rule supply', () => {
  const settings = State.normalizeSettings({});
  const buildPosition = (position) => {
    const value = State.createInitialState({ now: 1 });
    value.positions = { [`${position.chain}:${position.tokenAddress}`]: position };
    return value;
  };
  const buildTrade = (trade) => {
    const value = State.createInitialState({ now: 1 });
    value.trades = [trade];
    return value;
  };
  const validRulePosition = validPosition({
    chain: 'base', tokenAddress: EVM_ADDRESS, launchpad: 'Clanker',
    valuationMode: 'MARKET_CAP', marketCapDivisor: 100_000_000_000,
    totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    averageEntryPriceUsd: 0.000002, averageEntryMarketCap: 200_000,
    lastPriceUsd: 0.000002, lastMarketCapUsd: 200_000
  });
  const validRuleTrade = validTrade({
    chain: 'base', tokenAddress: EVM_ADDRESS, nativeSymbol: 'ETH', launchpad: 'Clanker',
    valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED',
    totalSupply: 100_000_000_000, supplySource: 'LAUNCHPAD_RULE',
    observedPriceUsd: 0.000002, executionPriceUsd: 0.000002, marketCapUsd: 200_000
  });

  assert.doesNotThrow(() => State.normalizeState(buildPosition(validRulePosition), settings, { strict: true }));
  assert.doesNotThrow(() => State.normalizeState(buildTrade(validRuleTrade), settings, { strict: true }));

  const invalidRulePosition = {
    ...validRulePosition, marketCapDivisor: 1_000_000_000, totalSupply: 1_000_000_000,
    averageEntryPriceUsd: 0.0002, lastPriceUsd: 0.0002
  };
  const invalidRuleTrade = {
    ...validRuleTrade, totalSupply: 1_000_000_000,
    observedPriceUsd: 0.0002, executionPriceUsd: 0.0002
  };
  assert.throws(
    () => State.normalizeState(buildPosition(invalidRulePosition), settings, { strict: true }),
    /invalidPosition/
  );
  assert.throws(
    () => State.normalizeState(buildTrade(invalidRuleTrade), settings, { strict: true }),
    /invalidTrade/
  );
});

test('selected-chain reset removes only that chain calibration events', () => {
  const state = State.createInitialState({ now: 1 });
  state.calibrations = [
    { id: 'eth', chain: 'eth', tokenAddress: EVM_ADDRESS, reason: 'PRICE', fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 1, toNativePriceUsd: 2, fromSupply: 0, toSupply: 0, quantityBefore: 1, quantityAfter: 1, costBasisNative: 1, createdAt: 2 },
    { id: 'base', chain: 'base', tokenAddress: EVM_ADDRESS, reason: 'PRICE', fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 1, toNativePriceUsd: 2, fromSupply: 0, toSupply: 0, quantityBefore: 1, quantityAfter: 1, costBasisNative: 1, createdAt: 2 }
  ];
  assert.deepEqual(State.resetChain(state, 'eth', 10, 3).calibrations.map((item) => item.chain), ['base']);
});

test('v1 migration preserves Solana economics and initializes only new chains', () => {
  const address = 'So11111111111111111111111111111111111111112';
  const canonicalKey = `sol:${address}`;
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
  assert.equal(state.positions[canonicalKey].costBasisNative, 4);
  assert.equal(state.positions[`sol:${address.toLowerCase()}`], undefined);
  assert.equal(state.trades[0].amountNative, 2);
  assert.equal(state.dailyRealizedByChain.sol['2026-07-18'].native, 1);
});

test('v1 migration backfills trusted provenance for a coherent legacy Pump position', () => {
  const legacyKey = `sol:${PUMP_ADDRESS.toLowerCase()}`;
  const key = `sol:${PUMP_ADDRESS}`;
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: 0 },
    positions: { [legacyKey]: legacyMarketCapPosition() },
    trades: [], dailyRealized: {}, initialized: true
  };
  const migrated = State.normalizeState(legacy, State.normalizeSettings({}));
  assert.equal(migrated.positions[key].marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.equal(migrated.positions[key].totalSupply, 1_000_000_000);
  assert.equal(migrated.positions[key].supplySource, 'LEGACY_PUMP_RULE');

  const freshQuote = {
    priceUsd: 0, marketCapUsd: 6_000, nativePriceUsd: 100,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const sold = Engine.executeSell(migrated, {
    token: { chain: 'sol', address: PUMP_ADDRESS }, quote: freshQuote, percent: 10
  }, State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, networkFeeSol: 0 }), 2_000);
  assert.equal(sold.trade.observedPriceUsd, 0.000006);
  assert.ok(sold.trade.amountNative > 0);
});

test('strict imports reject unsafe provenance while non-strict normalization strips it', () => {
  const state = State.createInitialState({ now: 1 });
  state.trades = [validTrade({
    provisional: 'yes', syntheticTokenPrice: true, totalSupply: 1_000_000_000,
    supplySource: 'FORGED', launchpad: 'x'.repeat(101)
  })];
  assert.throws(
    () => State.normalizeState(state, State.normalizeSettings({}), { strict: true }),
    /invalidTrade/
  );
  const normalized = State.normalizeState(state, State.normalizeSettings({}));
  assert.equal(normalized.trades[0].provisional, undefined);
  assert.equal(normalized.trades[0].syntheticTokenPrice, true);
  assert.equal(normalized.trades[0].supplySource, undefined);
  assert.equal(normalized.trades[0].launchpad, undefined);
});

test('calibrations normalize addresses and strict imports reject overflow without truncation', () => {
  const state = State.createInitialState({ now: 1 });
  const valid = {
    id: 'c1', chain: 'eth', tokenAddress: `0x${EVM_ADDRESS.slice(2).toUpperCase()}`, reason: 'PRICE',
    fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 1, toNativePriceUsd: 2,
    fromSupply: 0, toSupply: 0, quantityBefore: 1, quantityAfter: 1, costBasisNative: 1, createdAt: 2
  };
  state.calibrations = Array.from({ length: Tango.MAX_TRADES + 1 }, (_, index) => ({ ...valid, id: `c${index}` }));
  assert.throws(() => State.normalizeState(state, State.normalizeSettings({}), { strict: true }), /importTooManyRecords/);
  const normalized = State.normalizeState(state, State.normalizeSettings({}));
  assert.equal(normalized.calibrations.length, Tango.MAX_TRADES + 1);
  assert.equal(normalized.calibrations[0].tokenAddress, EVM_ADDRESS);
  state.calibrations = [{ ...valid, reason: 'FORGED' }];
  assert.throws(
    () => State.normalizeState(state, State.normalizeSettings({}), { strict: true }),
    /invalidCalibration/
  );
});

test('v2 normalization backfills only coherent legacy Solana Pump market-cap positions', () => {
  const state = State.createInitialState({ now: 1 });
  const validKey = `sol:${PUMP_ADDRESS}`;
  const evmAddress = '0x1111111111111111111111111111111111111111';
  state.positions = {
    [validKey]: legacyMarketCapPosition({ costBasisNative: 1 }),
    [`eth:${evmAddress}`]: legacyMarketCapPosition({
      chain: 'eth', tokenAddress: evmAddress, costBasisNative: 1
    }),
    'sol:So11111111111111111111111111111111111111112': legacyMarketCapPosition({
      tokenAddress: 'So11111111111111111111111111111111111111112', costBasisNative: 1
    }),
    'sol:BbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP': legacyMarketCapPosition({
      tokenAddress: 'BbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP', costBasisNative: 1,
      marketCapDivisor: 1_000_000
    }),
    'sol:CbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP': legacyMarketCapPosition({
      tokenAddress: 'CbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP', costBasisNative: 1,
      averageEntryPriceUsd: 2, lastPriceUsd: 2
    }),
    'sol:DbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP': legacyMarketCapPosition({
      tokenAddress: 'DbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP', costBasisNative: Infinity
    }),
    'sol:EbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP': legacyMarketCapPosition({
      tokenAddress: 'EbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP', costBasisNative: 1,
      averageEntryPriceUsd: Infinity
    })
  };
  const normalized = State.normalizeState(state, State.normalizeSettings({}));
  assert.equal(normalized.positions[validKey].marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  Object.entries(normalized.positions).filter(([key]) => key !== validKey).forEach(([, position]) => {
    assert.equal(position.marketCapProvenance, undefined);
  });
});

test('v2 normalization recognizes a real default-slippage legacy Pump position', () => {
  const pumpToken = {
    chain: 'sol', address: PUMP_ADDRESS, symbol: 'PUMP', name: 'Pump',
    metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  };
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const current = State.createInitialState({ now: 1 });
  current.initialized = true;
  const bought = Engine.executeBuy(
    current,
    { token: pumpToken, quote: marketCapQuote, amountNative: 1 },
    State.normalizeSettings({}),
    1_000
  ).state;
  const key = `sol:${PUMP_ADDRESS}`;
  delete bought.positions[key].marketCapProvenance;

  const normalized = State.normalizeState(bought, State.normalizeSettings({}));
  assert.equal(normalized.positions[key].marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
});

test('v2 normalization recognizes a real legacy Pump position after repeat buys', () => {
  const pumpToken = {
    chain: 'sol', address: PUMP_ADDRESS, symbol: 'PUMP', name: 'Pump',
    metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  };
  const settings = State.normalizeSettings({});
  const firstQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const secondQuote = { ...firstQuote, marketCapUsd: 6_000, observedAt: 2_000 };
  const current = State.createInitialState({ now: 1 });
  current.initialized = true;
  const first = Engine.executeBuy(
    current, { token: pumpToken, quote: firstQuote, amountNative: 1 }, settings, 1_000
  );
  const second = Engine.executeBuy(
    first.state, { token: pumpToken, quote: secondQuote, amountNative: 1 }, settings, 2_000
  ).state;
  const key = `sol:${PUMP_ADDRESS}`;
  delete second.positions[key].marketCapProvenance;

  const normalized = State.normalizeState(second, settings);
  assert.equal(normalized.positions[key].marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
});

test('normalization is idempotent', () => {
  const once = State.normalizeState(State.createInitialState({ now: 1000 }), State.normalizeSettings({}));
  assert.deepEqual(State.normalizeState(once, State.normalizeSettings({})), once);
});

test('direct v1 normalization derives deterministic timestamps without a coordinator', () => {
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: 0 },
    positions: {}, trades: [], dailyRealized: {}, initialized: true
  };
  const first = State.normalizeState(legacy, State.normalizeSettings({}));
  const second = State.normalizeState(legacy, State.normalizeSettings({}));
  assert.deepEqual(second, first);
  assert.equal(first.accounts.eth.createdAt, 0);
  assert.equal(first.accounts.eth.updatedAt, 0);
});

test('non-strict v1 migration preserves legacy numeric timestamp recovery', () => {
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: 0, createdAt: '10', updatedAt: '20' },
    positions: {}, trades: [], dailyRealized: {}, initialized: true
  };
  const migrated = State.normalizeState(legacy, State.normalizeSettings({}));
  assert.equal(migrated.accounts.eth.createdAt, 20);
  assert.equal(migrated.accounts.eth.updatedAt, 20);
});

test('settings move legacy Solana values into the Solana chain only', () => {
  const settings = State.normalizeSettings({ buyPresets: [1, 2], networkFeeSol: 0.002, initialBalanceSol: 25 });
  assert.deepEqual(settings.chains.sol.buyPresets, [1, 2]);
  assert.equal(settings.chains.sol.networkFeeNative, 0.002);
  assert.equal(settings.chains.sol.initialBalanceNative, 25);
  assert.equal(Object.hasOwn(settings, 'buyPresets'), false);
  assert.equal(Object.hasOwn(settings, 'networkFeeSol'), false);
  assert.equal(Object.hasOwn(settings, 'initialBalanceSol'), false);
});

test('settings always expose a canonical registered selected chain', () => {
  assert.equal(State.normalizeSettings({}).selectedChain, 'sol');
  assert.equal(State.normalizeSettings({ buyPresets: [1], networkFeeSol: 0.002 }).selectedChain, 'sol');
  assert.equal(State.normalizeSettings({ selectedChain: 'wat' }).selectedChain, 'sol');
  assert.equal(State.normalizeSettings({ selectedChain: 'ETH' }).selectedChain, 'eth');
});

test('v2 trade normalization derives the registered chain native symbol', () => {
  const state = State.createInitialState({ now: 1000 });
  state.trades = [{ id: 'bsc-1', chain: 'bsc', amountNative: 1 }];
  const normalized = State.normalizeState(state, State.normalizeSettings({}));
  assert.equal(normalized.trades[0].nativeSymbol, 'BNB');
});

test('strict v2 import rejects an inconsistent native symbol and repairs a missing one', () => {
  const state = State.createInitialState({ now: 1000 });
  state.trades = [validTrade({ chain: 'bsc', tokenAddress: '0xb111111111111111111111111111111111111111', nativeSymbol: 'SOL' })];
  assert.throws(() => State.normalizeState(state, State.normalizeSettings({}), { strict: true }), /invalidTrade/);
  state.trades[0] = validTrade({ chain: 'bsc', tokenAddress: '0xb111111111111111111111111111111111111111', nativeSymbol: undefined });
  const normalized = State.normalizeState(state, State.normalizeSettings({}), { strict: true });
  assert.equal(normalized.trades[0].nativeSymbol, 'BNB');
});

test('strict v2 import requires exact collection and registered-account structure', () => {
  const base = State.createInitialState({ now: 1000 });
  const cases = [
    ['accounts', { ...base.accounts, eth: undefined }],
    ['accounts', { ...base.accounts, wat: base.accounts.eth }],
    ['positions', []],
    ['trades', {}],
    ['dailyRealizedByChain', []]
  ];
  for (const [field, value] of cases) {
    const state = structuredClone(base);
    state[field] = value;
    assert.throws(
      () => State.normalizeState(state, State.normalizeSettings({}), { strict: true }),
      /invalid(State|Account|Positions|Trades|Daily)/
    );
  }
});

test('strict v2 import rejects non-array calibrations while allowing omission', () => {
  for (const value of [{}, null, 'calibration']) {
    const state = State.createInitialState({ now: 1 });
    state.calibrations = value;
    assert.throws(
      () => State.normalizeState(state, State.normalizeSettings({}), { strict: true }),
      /invalidCalibration/
    );
  }
  const legacyV2 = State.createInitialState({ now: 1 });
  delete legacyV2.calibrations;
  assert.deepEqual(
    State.normalizeState(legacyV2, State.normalizeSettings({}), { strict: true }).calibrations,
    []
  );
});

test('strict v2 import rejects malformed account, position, trade, and daily economics', () => {
  const settings = State.normalizeSettings({});
  const account = State.createInitialState({ now: 1000 });
  account.accounts.eth.cashBalanceNative = Infinity;
  assert.throws(() => State.normalizeState(account, settings, { strict: true }), /invalidAccount/);

  const tradeMutations = [
    { tokenAddress: 'bad' },
    { chain: 'ETH' },
    { quantity: -1 },
    { amountNative: Infinity },
    { nativePriceUsd: NaN },
    { executedAt: Infinity }
  ];
  for (const mutation of tradeMutations) {
    const state = State.createInitialState({ now: 1000 });
    state.trades = [validTrade(mutation)];
    assert.throws(() => State.normalizeState(state, settings, { strict: true }), /invalidTrade/);
  }

  const positioned = Engine.executeBuy(
    State.createInitialState({ now: 1 }),
    {
      token: { chain: 'eth', address: EVM_ADDRESS },
      quote: { priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000 },
      amountNative: 1
    },
    State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } } }),
    1_000
  ).state;
  positioned.positions[`eth:${EVM_ADDRESS}`].costBasisNative = Infinity;
  assert.throws(() => State.normalizeState(positioned, settings, { strict: true }), /invalidPosition/);

  const daily = State.createInitialState({ now: 1000 });
  daily.dailyRealizedByChain.eth['not-a-date'] = { native: Infinity, usdAtExecution: 0 };
  assert.throws(() => State.normalizeState(daily, settings, { strict: true }), /invalidDaily/);
});

test('strict settings reject unsafe global and per-chain values', () => {
  const cases = [
    { slippageBps: Infinity },
    { platformFeeBps: -1 },
    { fastMode: 'yes' },
    { sellPresets: [25, -1] },
    { chains: { eth: { networkFeeNative: Infinity } } },
    { chains: { eth: { initialBalanceNative: 0 } } },
    { chains: { wat: { networkFeeNative: 1 } } }
  ];
  cases.forEach((settings) => {
    assert.throws(() => State.normalizeSettings(settings, { strict: true }), /invalidSettings/);
  });
});

test('strict v2 settings reject present null and wrong-type global booleans and enums while allowing omission', () => {
  const canonical = State.normalizeSettings({});
  for (const field of GLOBAL_BOOLEAN_FIELDS) {
    for (const value of [null, 'true']) {
      assert.throws(
        () => State.normalizeSettings({ ...canonical, [field]: value }, { strict: true, requireAllChains: true }),
        /invalidSettings/,
        `${field}=${String(value)}`
      );
    }
  }
  for (const field of GLOBAL_ENUM_FIELDS) {
    for (const value of [null, 'invalid']) {
      assert.throws(
        () => State.normalizeSettings({ ...canonical, [field]: value }, { strict: true, requireAllChains: true }),
        /invalidSettings/,
        `${field}=${String(value)}`
      );
    }
  }
  for (const field of [...GLOBAL_BOOLEAN_FIELDS, ...GLOBAL_ENUM_FIELDS]) {
    const omitted = { ...canonical };
    delete omitted[field];
    assert.doesNotThrow(
      () => State.normalizeSettings(omitted, { strict: true, requireAllChains: true }),
      `omitted ${field}`
    );
  }
});

test('strict v1 settings apply the same present-value validation while allowing omitted globals', () => {
  const legacy = { buyPresets: [1], sellPresets: [25, 100], networkFeeSol: 0.001, initialBalanceSol: 10 };
  for (const field of GLOBAL_BOOLEAN_FIELDS) {
    for (const value of [null, 'true']) {
      assert.throws(
        () => State.normalizeSettings({ ...legacy, [field]: value }, { strict: true }),
        /invalidSettings/,
        `${field}=${String(value)}`
      );
    }
  }
  for (const field of GLOBAL_ENUM_FIELDS) {
    for (const value of [null, 'invalid']) {
      assert.throws(
        () => State.normalizeSettings({ ...legacy, [field]: value }, { strict: true }),
        /invalidSettings/,
        `${field}=${String(value)}`
      );
    }
  }
  assert.doesNotThrow(() => State.normalizeSettings(legacy, { strict: true }));
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

test('strict normalization rejects an invalid imported position', () => {
  const state = State.createInitialState({ now: 1000 });
  state.positions['eth:invalid'] = { chain: 'eth', tokenAddress: 'invalid', quantity: 1 };
  assert.throws(() => State.normalizeState(state, State.normalizeSettings({}), { strict: true }), /invalidPosition/);
});

test('strict state rejects a position opened after its latest update', () => {
  const initial = State.createInitialState({ now: 1 });
  const bought = Engine.executeBuy(initial, { token: { chain: 'eth', address: '0x1111111111111111111111111111111111111111' },
    quote: { priceUsd: 2, nativePriceUsd: 2000, observedAt: 1000, nativePriceObservedAt: 1000 }, amountNative: 1 }, State.normalizeSettings({}), 1000);
  bought.position.openedAt = Number.MAX_SAFE_INTEGER;
  assert.throws(() => State.normalizeState(bought.state, State.normalizeSettings({}), { strict: true }), /invalidPosition/);
});

test('strict settings use the executable upper boundary for slippage and platform fees', () => {
  for (const field of ['slippageBps', 'platformFeeBps']) {
    assert.doesNotThrow(() => State.normalizeSettings({ [field]: 9999 }, { strict: true }));
    assert.throws(() => State.normalizeSettings({ [field]: 10000 }, { strict: true }), /invalidSettings/);
  }
});

test('strict import rejects a Base58 Solana identity that does not decode to 32 bytes', () => {
  const state = State.createInitialState({ now: 1 });
  const address = '11111111111111111111111111111111pump';
  state.positions[`sol:${address}`] = validPosition({ chain: 'sol', tokenAddress: address });
  assert.throws(
    () => State.normalizeState(state, State.normalizeSettings({}), { strict: true }),
    /invalidPosition/
  );
});

test('strict v2 import rejects forged market-cap provenance and incoherent valuation context', () => {
  const settings = State.normalizeSettings({});
  const trustedPosition = validPosition({
    chain: 'sol', tokenAddress: VALID_PUMP_ADDRESS,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000,
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
  });
  const build = (position) => {
    const state = State.createInitialState({ now: 1 });
    state.positions = { [`${position.chain}:${position.tokenAddress}`]: position };
    return state;
  };

  assert.doesNotThrow(() => State.normalizeState(build(trustedPosition), settings, { strict: true }));
  for (const mutation of [
    { marketCapProvenance: 'FORGED' },
    { valuationMode: 'FORGED' },
    { valuationMode: 'PRICE' },
    { marketCapDivisor: 1 },
    { chain: 'eth', tokenAddress: EVM_ADDRESS },
    { tokenAddress: 'So11111111111111111111111111111111111111112' }
  ]) {
    const position = { ...trustedPosition, ...mutation };
    assert.throws(
      () => State.normalizeState(build(position), settings, { strict: true }),
      /invalidPosition/,
      JSON.stringify(mutation)
    );
  }
});

test('strict v2 import rejects unknown trade market-cap provenance', () => {
  const state = State.createInitialState({ now: 1 });
  state.trades = [validTrade({ marketCapProvenance: 'FORGED' })];
  assert.throws(
    () => State.normalizeState(state, State.normalizeSettings({}), { strict: true }),
    /invalidTrade/
  );
});

test('strict v2 import rejects incoherent trade market-cap relationships', () => {
  const settings = State.normalizeSettings({});
  const coherent = validTrade({
    chain: 'sol', tokenAddress: VALID_PUMP_ADDRESS, nativeSymbol: 'SOL',
    valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED',
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
  });
  const build = (trade) => {
    const state = State.createInitialState({ now: 1 });
    state.trades = [trade];
    return state;
  };

  assert.doesNotThrow(() => State.normalizeState(build(coherent), settings, { strict: true }));
  for (const trade of [
    { ...coherent, chain: 'eth', tokenAddress: EVM_ADDRESS, nativeSymbol: 'ETH' },
    { ...coherent, tokenAddress: 'So11111111111111111111111111111111111111112' },
    { ...coherent, valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE' },
    validTrade({ valuationMode: 'MARKET_CAP' })
  ]) {
    assert.throws(
      () => State.normalizeState(build(trade), settings, { strict: true }),
      /invalidTrade/
    );
  }
});

test('explicit PRICE mode prevents legacy one-billion trade inference without price provenance', () => {
  const state = State.createInitialState({ now: 1 });
  state.trades = [validTrade({
    chain: 'sol', tokenAddress: VALID_PUMP_ADDRESS, nativeSymbol: 'SOL',
    observedPriceUsd: 2, executionPriceUsd: 2, marketCapUsd: 2_000_000_000,
    valuationMode: 'PRICE'
  })];

  const normalized = State.normalizeState(state, State.normalizeSettings({}), { strict: true });

  assert.equal(normalized.trades[0].valuationMode, 'PRICE');
  assert.equal(normalized.trades[0].priceProvenance, 'OBSERVED_PRICE');
  assert.equal(normalized.trades[0].marketCapProvenance, undefined);
});

test('normalization rebuilds position keys without collapsing case-sensitive Solana addresses', () => {
  const upper = 'So11111111111111111111111111111111111111112';
  const lower = 'so11111111111111111111111111111111111111112';
  const state = State.createInitialState({ now: 1000 });
  state.positions = {
    first: { chain: 'sol', tokenAddress: upper, quantity: 1 },
    second: { chain: 'sol', tokenAddress: lower, quantity: 2 }
  };

  const normalized = State.normalizeState(state, State.normalizeSettings({}));
  assert.equal(normalized.positions[`sol:${upper}`].quantity, 1);
  assert.equal(normalized.positions[`sol:${lower}`].quantity, 2);
  assert.equal(Object.keys(normalized.positions).length, 2);
});

test('strict v2 import rejects mismatched position keys and normalized collisions', () => {
  const address = '0xA111111111111111111111111111111111111111';
  const state = State.createInitialState({ now: 1000 });
  state.positions = { wrong: validPosition({ tokenAddress: address }) };
  assert.throws(() => State.normalizeState(state, State.normalizeSettings({}), { strict: true }), /invalidPosition/);

  state.positions = {
    'eth:0xa111111111111111111111111111111111111111': validPosition({ tokenAddress: address.toLowerCase() }),
    'eth:0xA111111111111111111111111111111111111111': validPosition({ tokenAddress: address.toLowerCase(), quantity: 2 })
  };
  assert.throws(() => State.normalizeState(state, State.normalizeSettings({}), { strict: true }), /positionCollision/);
});

test('strict v1 import rejects an invalid legacy position', () => {
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 10, realizedPnlSol: 0, createdAt: 1, updatedAt: 1 },
    positions: { invalid: { chain: 'unknown', tokenAddress: 'not-an-address', quantity: 1 } },
    trades: [], dailyRealized: {}, initialized: true
  };
  assert.throws(() => State.normalizeState(legacy, State.normalizeSettings({}), { strict: true }), /invalidPosition/);
});

test('strict v1 import rejects a non-finite legacy balance', () => {
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: Infinity, realizedPnlSol: 0, createdAt: 1, updatedAt: 1 },
    positions: {}, trades: [], dailyRealized: {}, initialized: true
  };
  assert.throws(() => State.normalizeState(legacy, State.normalizeSettings({}), { strict: true }), /invalidAccount/);
});

test('strict v1 import applies equivalent validation to legacy trades and collection shapes', () => {
  const base = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 10, realizedPnlSol: 0, createdAt: 1, updatedAt: 1 },
    positions: {}, trades: [], dailyRealized: {}, initialized: true
  };
  const malformed = structuredClone(base);
  malformed.trades = [{
    id: 'bad', chain: 'sol', tokenAddress: PUMP_ADDRESS, side: 'BUY',
    amountSol: Infinity, quantity: -1, observedPriceUsd: 1, executionPriceUsd: 1,
    marketCapUsd: 1, liquidityUsd: 1, solPriceUsd: 100, slippageBps: 0,
    platformFeeSol: 0, networkFeeSol: 0, realizedPnlSol: 0, executedAt: 1
  }];
  assert.throws(() => State.normalizeState(malformed, State.normalizeSettings({}), { strict: true }), /invalidTrade/);

  const wrongCollection = structuredClone(base);
  wrongCollection.positions = [];
  assert.throws(() => State.normalizeState(wrongCollection, State.normalizeSettings({}), { strict: true }), /invalidPositions/);
});

test('strict v2 import accepts numeric zero but rejects coerced economic and timestamp values', () => {
  const settings = State.normalizeSettings({});
  const cases = [
    ['account cash', 'invalidAccount', (value) => {
      const state = State.createInitialState({ now: 1 });
      state.accounts.eth.cashBalanceNative = value;
      return state;
    }],
    ['account timestamp', 'invalidAccount', (value) => {
      const state = State.createInitialState({ now: 1 });
      state.accounts.eth.createdAt = value;
      return state;
    }],
    ['position quantity', 'invalidPosition', (value) => {
      const state = State.createInitialState({ now: 1 });
      state.positions[`eth:${EVM_ADDRESS}`] = validPosition({ quantity: value });
      return state;
    }],
    ['position timestamp', 'invalidPosition', (value) => {
      const state = State.createInitialState({ now: 1 });
      state.positions[`eth:${EVM_ADDRESS}`] = validPosition({ openedAt: value });
      return state;
    }],
    ['trade fee', 'invalidTrade', (value) => {
      const state = State.createInitialState({ now: 1 });
      state.trades = [validTrade({ platformFeeNative: value })];
      return state;
    }],
    ['trade timestamp', 'invalidTrade', (value) => {
      const state = State.createInitialState({ now: 1 });
      state.trades = [validTrade({ executedAt: value })];
      return state;
    }]
  ];

  for (const [label, error, build] of cases) {
    for (const value of [null, false, '']) {
      assert.throws(
        () => State.normalizeState(build(value), settings, { strict: true }),
        new RegExp(error),
        `${label} must reject ${String(value)}`
      );
    }
  }

  const zeroAccount = State.createInitialState({ now: 0 });
  zeroAccount.accounts.eth.cashBalanceNative = 0;
  zeroAccount.accounts.eth.realizedPnlNative = 0;
  assert.doesNotThrow(() => State.normalizeState(zeroAccount, settings, { strict: true }));

  const zeroPosition = State.createInitialState({ now: 0 });
  zeroPosition.positions[`eth:${EVM_ADDRESS}`] = validPosition({
    quantity: 0, costBasisNative: 0, realizedPnlNative: 0, openedAt: 0, updatedAt: 0,
    quoteObservedAt: 0, metadataUpdatedAt: 0
  });
  assert.doesNotThrow(() => State.normalizeState(zeroPosition, settings, { strict: true }));

  const zeroTrade = State.createInitialState({ now: 0 });
  zeroTrade.trades = [validTrade({
    amountNative: 0, marketCapUsd: 0, liquidityUsd: 0, slippageBps: 0,
    platformFeeNative: 0, networkFeeNative: 0, realizedPnlNative: 0,
    realizedPnlUsd: 0, executedAt: 0, entryMarketCapUsd: 0, heldMs: 0
  })];
  assert.doesNotThrow(() => State.normalizeState(zeroTrade, settings, { strict: true }));
});

test('strict v1 import accepts numeric zero but rejects coerced legacy economic and timestamp values', () => {
  const settings = State.normalizeSettings({});
  const legacyKey = `sol:${PUMP_ADDRESS.toLowerCase()}`;
  const cases = [
    ['account cash', 'invalidAccount', (value) => validLegacyState({
      account: { initialBalanceSol: 10, cashBalanceSol: value, realizedPnlSol: 0, createdAt: 1, updatedAt: 1 }
    })],
    ['account timestamp', 'invalidAccount', (value) => validLegacyState({
      account: { initialBalanceSol: 10, cashBalanceSol: 10, realizedPnlSol: 0, createdAt: value, updatedAt: 1 }
    })],
    ['position quantity', 'invalidPosition', (value) => validLegacyState({
      positions: { [legacyKey]: legacyMarketCapPosition({ quantity: value }) }
    })],
    ['position timestamp', 'invalidPosition', (value) => validLegacyState({
      positions: { [legacyKey]: legacyMarketCapPosition({ openedAt: value }) }
    })],
    ['trade fee', 'invalidTrade', (value) => validLegacyState({
      trades: [validLegacyTrade({ platformFeeSol: value })]
    })],
    ['trade timestamp', 'invalidTrade', (value) => validLegacyState({
      trades: [validLegacyTrade({ executedAt: value })]
    })]
  ];

  for (const [label, error, build] of cases) {
    for (const value of [null, false, '']) {
      assert.throws(
        () => State.normalizeState(build(value), settings, { strict: true }),
        new RegExp(error),
        `${label} must reject ${String(value)}`
      );
    }
  }

  const zeroAccount = validLegacyState({
    account: { initialBalanceSol: 10, cashBalanceSol: 0, realizedPnlSol: 0, createdAt: 0, updatedAt: 0 }
  });
  assert.doesNotThrow(() => State.normalizeState(zeroAccount, settings, { strict: true }));

  const zeroPosition = validLegacyState({
    positions: { [legacyKey]: legacyMarketCapPosition({
      quantity: 0, costBasisSol: 0, realizedPnlSol: 0, openedAt: 0, updatedAt: 0
    }) }
  });
  assert.doesNotThrow(() => State.normalizeState(zeroPosition, settings, { strict: true }));

  const zeroTrade = validLegacyState({
    trades: [validLegacyTrade({
      amountSol: 0, marketCapUsd: 0, liquidityUsd: 0, slippageBps: 0,
      platformFeeSol: 0, networkFeeSol: 0, realizedPnlSol: 0, executedAt: 0
    })]
  });
  assert.doesNotThrow(() => State.normalizeState(zeroTrade, settings, { strict: true }));
});

test('strict v1 import validates every present modern trade alias before migration', () => {
  const settings = State.normalizeSettings({});
  const aliases = ['amountNative', 'platformFeeNative', 'networkFeeNative', 'realizedPnlNative', 'nativePriceUsd'];
  for (const field of aliases) {
    const state = validLegacyState({ trades: [validLegacyTrade({ [field]: false })] });
    assert.throws(() => State.normalizeState(state, settings, { strict: true }), /invalidTrade/);
  }

  const state = validLegacyState({
    trades: [validLegacyTrade({
      amountNative: 2, platformFeeNative: 0, networkFeeNative: 0,
      realizedPnlNative: 0, nativePriceUsd: 101
    })]
  });
  const migrated = State.normalizeState(state, settings, { strict: true });
  assert.equal(migrated.trades[0].amountNative, 2);
  assert.equal(migrated.trades[0].nativePriceUsd, 101);
});

test('strict v1 import rejects a present null daily realized value without rejecting numeric zero', () => {
  const settings = State.normalizeSettings({});
  const malformed = validLegacyState({ dailyRealized: { '2026-07-18': null } });
  assert.throws(() => State.normalizeState(malformed, settings, { strict: true }), /invalidDaily/);

  const zero = validLegacyState({ dailyRealized: { '2026-07-18': 0 } });
  assert.doesNotThrow(() => State.normalizeState(zero, settings, { strict: true }));
});

test('strict settings validate both present chain-setting aliases before normalization', () => {
  assert.throws(() => State.normalizeSettings({
    chains: { eth: { networkFeeNative: 0 } },
    chainSettings: null
  }, { strict: true }), /invalidSettings/);

  assert.doesNotThrow(() => State.normalizeSettings({
    chains: { eth: { networkFeeNative: 0 } },
    chainSettings: { bsc: { networkFeeNative: 0 } }
  }, { strict: true }));
});


test('floating scale settings normalize and validate independently',()=>{
 const settings=State.normalizeSettings({barScale:.75,panelScale:1.5});assert.equal(settings.barScale,.75);assert.equal(settings.panelScale,1.5);
 assert.equal(State.normalizeSettings({}).barScale,1);assert.equal(State.normalizeSettings({}).panelScale,1);
 assert.equal(State.normalizeSettings({barScale:'huge',panelScale:Infinity}).panelScale,1);
 for(const field of ['barScale','panelScale']) for(const bad of [0,-1,2,NaN,Infinity,'1',null]) assert.throws(()=>State.normalizeSettings({[field]:bad},{strict:true}),/invalidSettings/);
 assert.doesNotThrow(()=>State.normalizeSettings(settings,{strict:true}));
});
