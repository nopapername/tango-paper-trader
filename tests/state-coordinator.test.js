const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');
const StateCoordinator = require('../src/core/state-coordinator.js');
const GLOBAL_BOOLEAN_FIELDS = [
  'enabled', 'fastMode', 'confirmationEnabled', 'soundEnabled', 'showListQuickBuy',
  'barCollapsed', 'panelCollapsed'
];
const GLOBAL_ENUM_FIELDS = ['language', 'displayCurrency', 'theme', 'pnlBarPosition', 'selectedChain'];

function memoryPersistence(initialState, initialSettings) {
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(initialState),
    [global.Tango.SETTINGS_KEY]: structuredClone(initialSettings)
  };
  const writes = [];
  return {
    values, writes,
    async readRaw(keys) {
      await Promise.resolve();
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]));
    },
    async writeRaw(next) {
      await Promise.resolve();
      writes.push(structuredClone(next));
      Object.assign(values, structuredClone(next));
    }
  };
}

const stateBytes = (state) => Buffer.byteLength(JSON.stringify(state), 'utf8');
const EVM_HISTORY_ADDRESS = '0xa111111111111111111111111111111111111111';
const EVM_OPEN_ADDRESS = '0xb222222222222222222222222222222222222222';

test('native quota failure becomes one storageFull failure without retry or state change', async () => {
  const state = storageStateFixture();
  state.stateRevision = 3;
  const settings = State.normalizeSettings({});
  const persistence = memoryPersistence(state, settings);
  let attempts = 0;
  const writeRaw = async () => {
    attempts += 1;
    const error = new Error('QUOTA_BYTES quota exceeded');
    error.name = 'QuotaExceededError';
    throw error;
  };
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw,
    now: () => 2_000
  });
  const expected = State.resetAll(settings, 2_000);
  expected.stateRevision = 4;

  await assert.rejects(
    coordinator.mutate({ type: 'RESET_ALL' }),
    (error) => {
      assert.equal(error.code, 'storageFull');
      assert.equal(error.measuredBytes, stateBytes(expected));
      assert.equal(error.budgetBytes, 8 * 1024 * 1024);
      return true;
    }
  );
  assert.equal(attempts, 1);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], state);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);
});

function storageStateFixture() {
  const state = State.createInitialState({ now: 1 });
  state.initialized = true;
  return state;
}

function storageTradeFixture({
  id,
  executedAt,
  tokenAddress = EVM_HISTORY_ADDRESS,
  side = 'BUY',
  sourceUrl = ''
}) {
  return {
    id,
    chain: 'eth',
    tokenAddress,
    symbol: 'SAFE',
    name: 'Safe',
    logoUrl: '',
    side,
    quantity: 1,
    amountNative: side === 'BUY' ? 1 : 0,
    observedPriceUsd: 2,
    executionPriceUsd: 2,
    marketCapUsd: 0,
    liquidityUsd: 0,
    nativePriceUsd: 2_000,
    nativeSymbol: 'ETH',
    slippageBps: 0,
    platformFeeNative: 0,
    networkFeeNative: 0,
    realizedPnlNative: 0,
    realizedPnlUsd: 0,
    valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE',
    quoteSource: 'GMGN_NETWORK',
    sourceUrl,
    executedAt
  };
}

function storageCalibrationFixture({ id, createdAt, tokenAddress = EVM_HISTORY_ADDRESS }) {
  return {
    id,
    chain: 'eth',
    tokenAddress,
    reason: 'PRICE',
    fromPriceUsd: 1,
    toPriceUsd: 2,
    fromNativePriceUsd: 2_000,
    toNativePriceUsd: 2_000,
    fromSupply: 0,
    toSupply: 0,
    quantityBefore: 1,
    quantityAfter: 1,
    costBasisNative: 1,
    createdAt
  };
}

function fallbackTradeFixture({ id, tokenAddress, side, executedAt }) {
  return {
    ...storageTradeFixture({ id, tokenAddress, side, executedAt }),
    observedPriceUsd: 0.0000032,
    executionPriceUsd: 0.0000032,
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
    supplySource: 'UNKNOWN_FALLBACK',
    launchpad: '',
    launchMode: '',
    quoteObservedAtOriginal: executedAt,
    nativePriceObservedAtOriginal: executedAt
  };
}

function openFallbackPosition(tokenAddress, openedAt, updatedAt) {
  return {
    chain: 'eth',
    tokenAddress,
    symbol: 'OPEN',
    name: 'Open',
    logoUrl: '',
    quantity: 1,
    costBasisNative: 1,
    averageEntryPriceUsd: 0.0000032,
    averageEntryMarketCap: 3_200,
    realizedPnlNative: 0,
    lastPriceUsd: 0.0000032,
    lastMarketCapUsd: 3_200,
    lastNativePriceUsd: 2_000,
    openedAt,
    quoteObservedAt: updatedAt,
    updatedAt,
    valuationMode: 'MARKET_CAP',
    marketCapDivisor: 1_000_000_000,
    lastPriceProvenance: 'SYNTHETIC_PRICE',
    averageEntryPriceProvenance: 'SYNTHETIC_PRICE',
    paperFallback: true,
    provisional: true,
    syntheticTokenPrice: true,
    syntheticNativePrice: false,
    totalSupply: 1_000_000_000,
    provisionalSupply: 1_000_000_000,
    provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1',
    supplySource: 'UNKNOWN_FALLBACK',
    launchpad: '',
    launchMode: '',
    needsCalibration: true,
    provisionalTokenPrice: true,
    provisionalNativePrice: false,
    quoteSource: 'TANGO_FALLBACK'
  };
}

test('storage compaction measures UTF-8 and uses the stable calibration-first removal key', () => {
  const settings = State.normalizeSettings({});
  const state = storageStateFixture();
  state.accounts.eth.memo = '璐︽埛馃敟';
  state.trades = [
    storageTradeFixture({ id: 'a-trade', executedAt: 1_000 }),
    storageTradeFixture({ id: 'trade-new', executedAt: 2_000 })
  ];
  state.calibrations = [
    storageCalibrationFixture({ id: 'z-cal', createdAt: 1_000 }),
    storageCalibrationFixture({ id: 'b-cal', createdAt: 1_000 }),
    storageCalibrationFixture({
      id: 'z-cal',
      createdAt: 1_000,
      tokenAddress: EVM_OPEN_ADDRESS
    })
  ];
  const normalized = State.normalizeState(state, settings);
  const expected = {
    ...normalized,
    calibrations: [normalized.calibrations[2]]
  };
  const before = structuredClone(state);

  const result = StateCoordinator.compactStateForStorage(state, settings, {
    budgetBytes: stateBytes(expected)
  });

  assert.equal(StateCoordinator.serializedStateBytes(state), stateBytes(state));
  assert.equal(result.measuredBytes, stateBytes(expected));
  assert.deepEqual(result.state, expected);
  assert.deepEqual(result.removedCalibrationIds, ['b-cal', 'z-cal']);
  assert.equal(result.state.calibrations[0].tokenAddress, EVM_OPEN_ADDRESS);
  assert.deepEqual(result.removedTradeIds, []);
  assert.deepEqual(state, before);
});

test('storage compaction removes a closed fallback unit atomically and retains an open unit closure', () => {
  const settings = State.normalizeSettings({});
  const state = storageStateFixture();
  state.trades = [
    fallbackTradeFixture({ id: 'open-dependent', tokenAddress: EVM_OPEN_ADDRESS, side: 'SELL', executedAt: 250 }),
    fallbackTradeFixture({ id: 'open-origin', tokenAddress: EVM_OPEN_ADDRESS, side: 'BUY', executedAt: 200 }),
    fallbackTradeFixture({ id: 'closed-dependent', tokenAddress: EVM_HISTORY_ADDRESS, side: 'SELL', executedAt: 150 }),
    fallbackTradeFixture({ id: 'closed-origin', tokenAddress: EVM_HISTORY_ADDRESS, side: 'BUY', executedAt: 100 })
  ];
  state.positions[`eth:${EVM_OPEN_ADDRESS}`] = openFallbackPosition(EVM_OPEN_ADDRESS, 200, 250);
  assert.doesNotThrow(() => State.normalizeState(state, settings, { strict: true }));
  const expected = State.normalizeState({
    ...state,
    trades: state.trades.filter(({ tokenAddress }) => tokenAddress === EVM_OPEN_ADDRESS)
  }, settings, { strict: true });

  const result = StateCoordinator.compactStateForStorage(state, settings, {
    budgetBytes: stateBytes(expected)
  });

  assert.deepEqual(result.removedTradeIds, ['closed-origin', 'closed-dependent']);
  assert.deepEqual(result.state.trades.map(({ id }) => id), ['open-dependent', 'open-origin']);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));
});

test('coordinator preserves a coherent observed market cap on a structured-cloned unknown fallback', async () => {
  const address = '0xa111111111111111111111111111111111111111';
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } }
  });
  const fallback = global.Tango.Supply.fallbackValuation({
    chain: 'eth', launchpad: 'Unknown'
  });
  const amountNative = 1;
  const executionNow = 20_000;
  const marketCapObservedAt = 19_900;
  const contentOrder = {
    token: { chain: 'eth', address, symbol: 'FALLBACK' },
    quote: {
      ...fallback,
      chain: 'eth', address,
      marketCapUsd: 5_000,
      priceUsd: 5_000 / 1_000_000_000,
      marketCapDivisor: fallback.totalSupply,
      provisionalSupply: fallback.totalSupply,
      nativePriceUsd: 2_000,
      observedAt: executionNow,
      nativePriceObservedAt: executionNow,
      source: 'TANGO_FALLBACK',
      valuationMode: 'MARKET_CAP',
      valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY',
      marketCapSource: 'GMGN_TRENCH',
      marketCapObservedAt,
      originalObservedAt: marketCapObservedAt,
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
      syntheticTokenPrice: true,
      provisional: true,
      paperFallback: true
    },
    amountNative
  };
  const clonedOrder = structuredClone(contentOrder);
  assert.equal(global.Tango.Supply.isInternalUnknownFallback(clonedOrder.quote), false);

  for (const forgedPatch of [
    {},
    { provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1' },
    { internalFallback: true, fallbackNonce: 'caller-selected' }
  ]) {
    assert.throws(
      () => Engine.executeBuy(
        initial,
        { ...clonedOrder, quote: { ...clonedOrder.quote, ...forgedPatch } },
        settings,
        executionNow
      ),
      /invalidQuote/
    );
  }

  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => executionNow
  });
  const result = await coordinator.mutate(structuredClone({
    type: 'EXECUTE_BUY', order: clonedOrder
  }));
  const key = Engine.positionKey('eth', address);

  assert.equal(result.position.totalSupply, 1_000_000_000);
  assert.equal(result.position.lastMarketCapUsd, 5_000);
  assert.equal(result.position.lastPriceUsd, 5_000 / 1_000_000_000);
  assert.equal(
    result.position.quantity,
    amountNative * contentOrder.quote.nativePriceUsd / (5_000 / 1_000_000_000)
  );
  assert.equal(result.position.supplySource, 'UNKNOWN_FALLBACK');
  assert.equal(result.position.provisionalSupply, 1_000_000_000);
  assert.equal(
    result.position.provisionalSupplyProvenance,
    'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
  );
  const persisted = await coordinator.getAll();
  assert.equal(persisted.state.positions[key].quantity, result.position.quantity);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(persisted.state), settings, { strict: true }
  ));

  const rejectedObservedMarketCaps = [
    ['wrong valuation source', { valuationSource: 'UNKNOWN_INITIAL_MARKET_CAP' }],
    ['wrong valuation mode', { valuationMode: 'PRICE' }],
    ['untrusted market-cap source', { marketCapSource: 'DEXSCREENER' }],
    ['cross-source market-cap provenance', { marketCapSource: 'GMGN_PRICE' }],
    ['future observation', {
      observedAt: executionNow + 1,
      marketCapObservedAt: executionNow + 1,
      originalObservedAt: executionNow + 1
    }],
    ['stale observation', { marketCapObservedAt: executionNow - 15_001 }],
    ['unsafe observation', { marketCapObservedAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['non-finite market cap', { marketCapUsd: Infinity }],
    ['non-positive market cap', { marketCapUsd: 0 }],
    ['noncanonical total supply', { totalSupply: 2_000_000_000 }],
    ['noncanonical market-cap divisor', { marketCapDivisor: 2_000_000_000 }],
    ['noncanonical provisional supply', { provisionalSupply: 2_000_000_000 }],
    ['forged caller source provenance', { source: 'TANGO_FALLBACK_CARD_MARKET_CAP' }],
    ['forged durable provenance', {
      provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1'
    }],
    ['incoherent price', { priceUsd: 0.01 }]
  ];
  for (const [label, patch] of rejectedObservedMarketCaps) {
    const rejectedPersistence = memoryPersistence(initial, settings);
    const rejectedCoordinator = StateCoordinator.create({
      readRaw: rejectedPersistence.readRaw,
      writeRaw: rejectedPersistence.writeRaw,
      now: () => executionNow
    });
    const rejected = await rejectedCoordinator.mutate({
      type: 'EXECUTE_BUY',
      order: structuredClone({
        ...contentOrder,
        quote: { ...contentOrder.quote, ...patch }
      })
    });
    assert.equal(rejected.position.lastMarketCapUsd, 3_200, label);
    assert.equal(rejected.position.lastPriceUsd, 3_200 / 1_000_000_000, label);
    assert.equal(rejected.trade.quoteSource, 'TANGO_FALLBACK', label);
    assert.equal(rejected.trade.quoteObservedAtOriginal, 0, label);
    if (label === 'future observation') {
      assert.equal(rejected.position.quoteObservedAt, executionNow, label);
    }
    assert.doesNotThrow(
      () => State.normalizeState(structuredClone(rejected.state), settings, { strict: true }),
      label
    );
  }
});

test('coordinator degrades a future factual-price narrowing to deterministic fallback', async () => {
  const address = '0xa111111111111111111111111111111111111111';
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } }
  });
  const fallback = global.Tango.Supply.fallbackValuation({
    chain: 'eth', launchpad: 'Unknown'
  });
  const executionNow = 20_000;
  const futureObservedAt = executionNow + 1;
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => executionNow
  });
  const futureFactualQuote = {
    ...fallback,
    chain: 'eth', address,
    priceUsd: 0.01,
    marketCapUsd: 3_200,
    totalSupply: 1_000_000_000,
    marketCapDivisor: 1_000_000_000,
    provisionalSupply: 1_000_000_000,
    nativePriceUsd: 1,
    observedAt: futureObservedAt,
    priceObservedAt: futureObservedAt,
    originalObservedAt: futureObservedAt,
    nativePriceObservedAt: executionNow,
    source: 'GMGN_NETWORK',
    priceSource: 'GMGN_NETWORK',
    priceObservationId: 'future-price-observation',
    marketCapSource: 'TANGO_FALLBACK',
    marketCapObservedAt: 0,
    marketCapObservationId: '',
    valuationMode: 'PRICE',
    valuationSource: 'OBSERVED_PRICE',
    priceProvenance: 'OBSERVED_PRICE',
    syntheticTokenPrice: false,
    provisional: false,
    paperFallback: true
  };

  const result = await coordinator.mutate(structuredClone({
    type: 'EXECUTE_BUY',
    order: {
      token: { chain: 'eth', address, symbol: 'PRICE_ONLY' },
      quote: futureFactualQuote,
      amountNative: 1
    }
  }));

  assert.equal(result.state.accounts.eth.cashBalanceNative, 9);
  assert.equal(Object.keys(result.state.positions).length, 1);
  assert.equal(result.state.trades.length, 1);
  assert.equal(result.position.lastMarketCapUsd, 3_200);
  assert.equal(result.position.lastPriceUsd, 3_200 / 1_000_000_000);
  assert.equal(result.position.quoteObservedAt, executionNow);
  assert.equal(result.trade.quoteSource, 'TANGO_FALLBACK');
  assert.equal(result.trade.quoteObservedAtOriginal, 0);
  assert.equal(result.trade.syntheticTokenPrice, true);
  assert.equal(result.trade.paperFallback, true);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(result.state), settings, { strict: true }
  ));

  const sold = await coordinator.mutate(structuredClone({
    type: 'EXECUTE_SELL',
    order: {
      token: { chain: 'eth', address, symbol: 'PRICE_ONLY' },
      quote: futureFactualQuote,
      percent: 100
    }
  }));
  assert.equal(sold.trade.side, 'SELL');
  assert.equal(sold.trade.quoteSource, 'TANGO_FALLBACK');
  assert.equal(sold.trade.quoteObservedAtOriginal, 0);
  assert.equal(sold.state.accounts.eth.cashBalanceNative, 10);
  assert.equal(Object.keys(sold.state.positions).length, 0);
  assert.doesNotThrow(() => State.normalizeState(
    structuredClone(sold.state), settings, { strict: true }
  ));
});

test('coordinator persists BUY and SELL with safe provenance when caller originals are unusable', async () => {
  for (const [label, originalObservedAt, nativeOriginalObservedAt] of [
    ['future', 20_001, 20_002],
    ['malformed', Number.NaN, Number.POSITIVE_INFINITY]
  ]) {
    const address = '0xa111111111111111111111111111111111111111';
    const initial = State.createInitialState({ now: 1 });
    initial.initialized = true;
    const settings = State.normalizeSettings({
      slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } }
    });
    const persistence = memoryPersistence(initial, settings);
    const coordinator = StateCoordinator.create({
      readRaw: persistence.readRaw,
      writeRaw: persistence.writeRaw,
      now: () => 20_000
    });
    const orderQuote = {
      priceUsd: 2,
      marketCapUsd: 2_000_000,
      nativePriceUsd: 2_000,
      observedAt: 19_000,
      nativePriceObservedAt: 18_900,
      originalObservedAt,
      nativeOriginalObservedAt,
      source: 'GMGN_NETWORK',
      valuationMode: 'PRICE',
      priceProvenance: 'OBSERVED_PRICE'
    };

    const bought = await coordinator.mutate({
      type: 'EXECUTE_BUY',
      order: {
        token: { chain: 'eth', address, symbol: 'SAFE' },
        quote: orderQuote,
        amountNative: 1
      }
    });
    assert.equal(bought.trade.quoteObservedAtOriginal, 19_000, label);
    assert.equal(bought.trade.nativePriceObservedAtOriginal, 18_900, label);
    assert.equal(bought.position.quoteObservedAt, 19_000, label);

    const sold = await coordinator.mutate({
      type: 'EXECUTE_SELL',
      order: {
        token: { chain: 'eth', address, symbol: 'SAFE' },
        quote: orderQuote,
        percent: 50
      }
    });
    assert.equal(sold.trade.quoteObservedAtOriginal, 19_000, label);
    assert.equal(sold.trade.nativePriceObservedAtOriginal, 18_900, label);
    assert.equal(sold.position.quoteObservedAt, 19_000, label);
    assert.doesNotThrow(() => State.normalizeState(
      structuredClone(sold.state), settings, { strict: true }
    ), label);
    assert.deepEqual(
      persistence.values[global.Tango.STORAGE_KEY],
      sold.state,
      label
    );
  }
});

test('serializes buys from two contexts without losing either chain', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: {
      eth: { networkFeeNative: 0 },
      bsc: { networkFeeNative: 0 }
    }
  });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 1_000
  });
  const quote = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000
  };

  const [eth, bsc] = await Promise.all([
    coordinator.mutate({
      type: 'EXECUTE_BUY',
      order: {
        token: { chain: 'eth', address: '0x1111111111111111111111111111111111111111' },
        quote,
        amountNative: 1
      }
    }),
    coordinator.mutate({
      type: 'EXECUTE_BUY',
      order: {
        token: { chain: 'bsc', address: '0x2222222222222222222222222222222222222222' },
        quote,
        amountNative: 1
      }
    })
  ]);

  const final = await coordinator.getAll();
  assert.equal(eth.trade.chain, 'eth');
  assert.equal(bsc.trade.chain, 'bsc');
  assert.equal(final.state.accounts.eth.cashBalanceNative, 9);
  assert.equal(final.state.accounts.bsc.cashBalanceNative, 9);
  assert.deepEqual(Object.keys(final.state.positions).sort(), [
    Engine.positionKey('bsc', '0x2222222222222222222222222222222222222222'),
    Engine.positionKey('eth', '0x1111111111111111111111111111111111111111')
  ]);
  assert.equal(final.state.stateRevision, 2);
});

test('serializes scoped settings patches from stale Popup, Dashboard, and content snapshots', async () => {
  const initial = State.createInitialState({ now: 1 });
  const settings = State.normalizeSettings({
    selectedChain: 'sol',
    language: 'zh-CN',
    displayCurrency: 'USD',
    theme: 'dark',
    chains: {
      eth: { buyPresets: [0.25, 0.5], networkFeeNative: 0.002, initialBalanceNative: 20 },
      bsc: { buyPresets: [1, 2], networkFeeNative: 0.003, initialBalanceNative: 30 },
      base: { buyPresets: [3, 4], networkFeeNative: 0.004, initialBalanceNative: 40 }
    }
  });
  const popupSnapshot = structuredClone(settings);
  const dashboardSnapshot = structuredClone(settings);
  const contentSnapshot = structuredClone(settings);
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw
  });

  await Promise.all([
    coordinator.mutate({
      type: 'PATCH_SETTINGS',
      patch: { selectedChain: popupSnapshot.selectedChain === 'sol' ? 'base' : 'sol' }
    }),
    coordinator.mutate({
      type: 'PATCH_SETTINGS',
      patch: {
        theme: dashboardSnapshot.theme === 'dark' ? 'light' : 'dark',
        chains: { eth: { networkFeeNative: dashboardSnapshot.chains.eth.networkFeeNative + 0.01 } }
      }
    }),
    coordinator.mutate({
      type: 'PATCH_SETTINGS',
      patch: {
        sellPresets: contentSnapshot.sellPresets.slice().reverse(),
        chains: { bsc: { buyPresets: [...contentSnapshot.chains.bsc.buyPresets, 3] } }
      }
    })
  ]);

  const final = (await coordinator.getAll()).settings;
  assert.equal(final.selectedChain, 'base');
  assert.equal(final.language, 'zh-CN');
  assert.equal(final.displayCurrency, 'USD');
  assert.equal(final.theme, 'light');
  assert.deepEqual(final.sellPresets, settings.sellPresets.slice().reverse());
  assert.equal(final.chains.eth.networkFeeNative, 0.012);
  assert.deepEqual(final.chains.eth.buyPresets, settings.chains.eth.buyPresets);
  assert.equal(final.chains.eth.initialBalanceNative, settings.chains.eth.initialBalanceNative);
  assert.deepEqual(final.chains.bsc.buyPresets, [1, 2, 3]);
  assert.equal(final.chains.bsc.networkFeeNative, settings.chains.bsc.networkFeeNative);
  assert.equal(final.chains.bsc.initialBalanceNative, settings.chains.bsc.initialBalanceNative);
  for (const chain of global.Tango.Chains.all().filter(({ id }) => !['eth', 'bsc'].includes(id))) {
    assert.deepEqual(final.chains[chain.id], settings.chains[chain.id]);
  }
});

test('a rejected settings patch does not poison later queued settings mutations', async () => {
  const initial = State.createInitialState({ now: 1 });
  const settings = State.normalizeSettings({ selectedChain: 'sol', language: 'en' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw
  });

  const rejected = coordinator.mutate({
    type: 'PATCH_SETTINGS',
    patch: { chains: { eth: { networkFeeNative: Infinity } } }
  });
  const accepted = coordinator.mutate({
    type: 'PATCH_SETTINGS',
    patch: { selectedChain: 'bsc' }
  });

  await assert.rejects(rejected, /invalidSettings/);
  assert.equal((await accepted).settings.selectedChain, 'bsc');
  const final = (await coordinator.getAll()).settings;
  assert.equal(final.selectedChain, 'bsc');
  assert.equal(final.language, 'en');
});

test('serializes periodic quote and metadata writes with a trade from another context', async () => {
  const address = 'So11111111111111111111111111111111111111112';
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { sol: { networkFeeNative: 0 }, bsc: { networkFeeNative: 0 } }
  });
  const base = State.createInitialState({ now: 1 });
  base.initialized = true;
  const bought = Engine.executeBuy(base, {
    token: {
      chain: 'sol', address, symbol: 'OLD', name: 'Old',
      metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    },
    quote: { priceUsd: 2, nativePriceUsd: 100, observedAt: 1_000, nativePriceObservedAt: 1_000 },
    amountNative: 1
  }, settings, 1_000).state;
  const persistence = memoryPersistence(bought, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  await Promise.all([
    coordinator.mutate({
      type: 'UPDATE_POSITION_QUOTE',
      token: { chain: 'sol', address },
      quote: {
        priceUsd: 3, nativePriceUsd: 120,
        observedAt: 2_000, nativePriceObservedAt: 2_000
      }
    }),
    coordinator.mutate({
      type: 'EXECUTE_BUY',
      order: {
        token: { chain: 'bsc', address: '0x3333333333333333333333333333333333333333' },
        quote: {
          priceUsd: 2, nativePriceUsd: 600,
          observedAt: 2_000, nativePriceObservedAt: 2_000
        },
        amountNative: 1
      }
    }),
    coordinator.mutate({
      type: 'UPDATE_POSITION_METADATA',
      token: {
        chain: 'sol', address, symbol: 'NEW', name: 'New',
        metadataVerified: true, metadataSource: 'GMGN_DETAIL'
      }
    })
  ]);

  const final = (await coordinator.getAll()).state;
  const position = final.positions[Engine.positionKey('sol', address)];
  assert.equal(position.lastPriceUsd, 3);
  assert.equal(position.lastNativePriceUsd, 120);
  assert.equal(position.symbol, 'NEW');
  assert.equal(final.accounts.bsc.cashBalanceNative, 9);
  assert.ok(final.positions[Engine.positionKey('bsc', '0x3333333333333333333333333333333333333333')]);
  assert.equal(final.stateRevision, 3);
});

test('quote calibration uses the coordinator clock and commits one revision', async () => {
  const timestamp = 2_500;
  const token = {
    chain: 'eth', address: '0x5555555555555555555555555555555555555555',
    symbol: 'SYN', metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  };
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const bought = Engine.executeBuy(initial, {
    token,
    quote: {
      priceUsd: 1, nativePriceUsd: 1,
      observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'TANGO_SYNTHETIC', provisional: true,
      syntheticTokenPrice: true, syntheticNativePrice: true,
      valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
    },
    amountNative: 1
  }, settings, 1_000).state;
  const persistence = memoryPersistence(bought, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => timestamp
  });

  const calibrated = await coordinator.mutate({
    type: 'UPDATE_POSITION_QUOTE',
    token,
    quote: {
      priceUsd: 2, nativePriceUsd: 3_000,
      observedAt: 2_000, nativePriceObservedAt: 2_000,
      source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
    }
  });

  assert.equal(calibrated.state.calibrations.length, 1);
  assert.equal(calibrated.state.calibrations[0].createdAt, timestamp);
  assert.equal(calibrated.state.stateRevision, bought.stateRevision + 1);
  assert.equal(persistence.writes.length, 1);
});

test('quote refresh rejects stale observations against the coordinator clock without a write', async () => {
  const token = {
    chain: 'eth', address: '0x5555555555555555555555555555555555555555',
    symbol: 'SYN', metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  };
  const settings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const bought = Engine.executeBuy(initial, {
    token,
    quote: {
      priceUsd: 1, nativePriceUsd: 1,
      observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'TANGO_SYNTHETIC', provisional: true,
      syntheticTokenPrice: true, syntheticNativePrice: true,
      valuationMode: 'PRICE', priceProvenance: 'SYNTHETIC_PRICE'
    },
    amountNative: 1
  }, settings, 1_000).state;
  const persistence = memoryPersistence(bought, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 1_000 + Tango.QUOTE_STALE_MS + 1
  });

  const result = await coordinator.mutate({
    type: 'UPDATE_POSITION_QUOTE',
    token,
    quote: {
      priceUsd: 2, nativePriceUsd: 3_000,
      observedAt: 1_000, nativePriceObservedAt: 1_000,
      source: 'GMGN_NETWORK', valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
    }
  });
  const key = Engine.positionKey('eth', token.address);

  assert.equal(result.state.positions[key].lastPriceUsd, 1);
  assert.equal(result.state.stateRevision, bought.stateRevision);
  assert.equal(persistence.writes.length, 0);
});

test('rejects a stale whole-state replacement by revision instead of erasing a newer mutation', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({});
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const left = structuredClone((await coordinator.getAll()).state);
  const right = structuredClone(left);
  left.accounts.eth.cashBalanceNative = 8;
  right.accounts.bsc.cashBalanceNative = 7;

  await coordinator.mutate({ type: 'REPLACE_STATE', state: left, expectedRevision: left.stateRevision });
  await assert.rejects(
    coordinator.mutate({ type: 'REPLACE_STATE', state: right, expectedRevision: right.stateRevision }),
    /stateConflict/
  );

  const final = (await coordinator.getAll()).state;
  assert.equal(final.accounts.eth.cashBalanceNative, 8);
  assert.equal(final.accounts.bsc.cashBalanceNative, 10);
  assert.equal(final.stateRevision, 1);
});

test('a sell queued from another context executes against the latest committed buy', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const persistence = memoryPersistence(initial, settings);
  let clock = 1_000;
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => clock++
  });
  const token = { chain: 'eth', address: '0x4444444444444444444444444444444444444444' };
  const quote = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000
  };

  const buy = coordinator.mutate({ type: 'EXECUTE_BUY', order: { token, quote, amountNative: 1 } });
  const sell = coordinator.mutate({
    type: 'EXECUTE_SELL',
    order: { token, quote: { ...quote, priceUsd: 3, observedAt: 1_001 }, percent: 100 }
  });
  const [, sold] = await Promise.all([buy, sell]);

  const final = (await coordinator.getAll()).state;
  assert.equal(sold.trade.side, 'SELL');
  assert.equal(final.positions[Engine.positionKey(token.chain, token.address)], undefined);
  assert.equal(final.trades.length, 2);
  assert.equal(final.stateRevision, 2);
});

test('stale native observations cannot mutate buy, sell, or close-all state and the queue recovers', async () => {
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const base = State.createInitialState({ now: 1 });
  base.initialized = true;
  const heldToken = { chain: 'eth', address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const laterToken = { chain: 'eth', address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };
  const freshQuote = {
    priceUsd: 2,
    nativePriceUsd: 2_000,
    observedAt: 50_000,
    nativePriceObservedAt: 50_000
  };
  const held = Engine.executeBuy(base, {
    token: heldToken, quote: freshQuote, amountNative: 1
  }, settings, 50_000).state;
  const before = structuredClone(held);
  const persistence = memoryPersistence(held, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 50_000
  });
  const staleNativeQuote = { ...freshQuote, priceUsd: 3, nativePriceObservedAt: 1 };

  const buy = coordinator.mutate({
    type: 'EXECUTE_BUY',
    order: { token: laterToken, quote: staleNativeQuote, amountNative: 1 }
  });
  const sell = coordinator.mutate({
    type: 'EXECUTE_SELL',
    order: { token: heldToken, quote: staleNativeQuote, percent: 50 }
  });
  const close = coordinator.mutate({
    type: 'EXECUTE_CLOSE_ALL',
    chain: 'eth',
    orders: [{ token: heldToken, quote: staleNativeQuote }]
  });

  await assert.rejects(buy, /staleQuote/);
  await assert.rejects(sell, /staleQuote/);
  const closeResult = await close;
  assert.equal(closeResult.trades.length, 0);
  assert.equal(closeResult.failures.length, 1);
  assert.equal(closeResult.failures[0].reason, 'staleQuote');
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], before);

  const committed = await coordinator.mutate({
    type: 'EXECUTE_BUY',
    order: { token: laterToken, quote: freshQuote, amountNative: 1 }
  });
  assert.equal(persistence.writes.length, 1);
  assert.ok(committed.state.positions[Engine.positionKey(laterToken.chain, laterToken.address)]);
  assert.deepEqual(
    committed.state.positions[Engine.positionKey(heldToken.chain, heldToken.address)],
    before.positions[Engine.positionKey(heldToken.chain, heldToken.address)]
  );
});

test('close-all and reset commands mutate the latest queued state under the same coordinator', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 }, bsc: { networkFeeNative: 0 } }
  });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 1_000
  });
  const eth = { chain: 'eth', address: '0x5555555555555555555555555555555555555555' };
  const bsc = { chain: 'bsc', address: '0x6666666666666666666666666666666666666666' };
  const quote = {
    priceUsd: 2, nativePriceUsd: 2_000,
    observedAt: 1_000, nativePriceObservedAt: 1_000
  };
  await coordinator.mutate({ type: 'EXECUTE_BUY', order: { token: eth, quote, amountNative: 1 } });
  await coordinator.mutate({ type: 'EXECUTE_BUY', order: { token: bsc, quote, amountNative: 1 } });

  const closed = await coordinator.mutate({
    type: 'EXECUTE_CLOSE_ALL', chain: 'eth', orders: [{ token: eth, quote }]
  });
  assert.equal(closed.trades.length, 1);
  assert.equal(closed.state.positions[Engine.positionKey(eth.chain, eth.address)], undefined);
  assert.ok(closed.state.positions[Engine.positionKey(bsc.chain, bsc.address)]);

  const resetChain = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'bsc', balanceNative: 25 });
  assert.equal(resetChain.state.accounts.bsc.cashBalanceNative, 25);
  assert.equal(resetChain.state.positions[Engine.positionKey(bsc.chain, bsc.address)], undefined);
  const resetAll = await coordinator.mutate({ type: 'RESET_ALL' });
  assert.equal(resetAll.state.accounts.bsc.cashBalanceNative, 25);
  assert.equal(resetAll.state.accounts.eth.cashBalanceNative, 10);
  assert.equal(resetAll.state.stateRevision, 5);
});

test('selected-chain reset atomically commits its custom principal to state and settings', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  initial.accounts.eth.cashBalanceNative = 4;
  initial.accounts.bsc.cashBalanceNative = 7;
  initial.dailyRealizedByChain.eth['2026-01-01'] = { native: -1, usdAtExecution: -2_000 };
  const settings = State.normalizeSettings({
    selectedChain: 'base',
    language: 'zh-CN',
    chains: {
      eth: { buyPresets: [0.25, 0.5], networkFeeNative: 0.002, initialBalanceNative: 20 },
      bsc: { buyPresets: [1, 2], networkFeeNative: 0.003, initialBalanceNative: 30 }
    }
  });
  const beforeState = structuredClone(initial);
  const beforeSettings = structuredClone(settings);
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const committed = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: 42 });

  assert.equal(persistence.writes.length, 1);
  assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
    global.Tango.SETTINGS_KEY,
    global.Tango.STORAGE_KEY
  ].sort());
  assert.equal(committed.state.stateRevision, beforeState.stateRevision + 1);
  assert.equal(committed.state.accounts.eth.initialBalanceNative, 42);
  assert.equal(committed.state.accounts.eth.cashBalanceNative, 42);
  assert.deepEqual(committed.state.dailyRealizedByChain.eth, {});
  assert.equal(committed.settings.chains.eth.initialBalanceNative, 42);
  assert.deepEqual(committed.state.accounts.bsc, beforeState.accounts.bsc);
  assert.deepEqual(committed.state.dailyRealizedByChain.bsc, beforeState.dailyRealizedByChain.bsc);
  assert.deepEqual(committed.settings.chains.bsc, beforeSettings.chains.bsc);
  assert.equal(committed.settings.selectedChain, beforeSettings.selectedChain);
  assert.equal(committed.settings.language, beforeSettings.language);
});

test('invalid selected-chain reset principals never write and do not poison the queue', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  initial.accounts.eth.cashBalanceNative = 4;
  const settings = State.normalizeSettings({
    selectedChain: 'sol',
    chains: { eth: { initialBalanceNative: 20 }, bsc: { initialBalanceNative: 30 } }
  });
  const beforeState = structuredClone(initial);
  const beforeSettings = structuredClone(settings);
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  for (const balanceNative of [Infinity, NaN, 0, -1, 1e15 + 1, '10', null, true, {}]) {
    await assert.rejects(
      coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative }),
      /invalidResetPrincipal/
    );
    assert.equal(persistence.writes.length, 0);
  }
  await assert.rejects(
    coordinator.mutate({ type: 'RESET_CHAIN', chain: 'unknown', balanceNative: 10 }),
    /unsupportedChain/
  );
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], beforeState);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], beforeSettings);

  const rejected = coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: Infinity });
  const accepted = coordinator.mutate({ type: 'RESET_CHAIN', chain: 'bsc', balanceNative: 25 });
  await assert.rejects(rejected, /invalidResetPrincipal/);
  const committed = await accepted;
  assert.equal(persistence.writes.length, 1);
  assert.equal(committed.state.accounts.bsc.cashBalanceNative, 25);
  assert.equal(committed.settings.chains.bsc.initialBalanceNative, 25);
  assert.equal(committed.state.accounts.eth.cashBalanceNative, beforeState.accounts.eth.cashBalanceNative);
  assert.equal(committed.settings.chains.eth.initialBalanceNative, beforeSettings.chains.eth.initialBalanceNative);
});

test('common-capital reset atomically recreates all six paper accounts and preserves non-account settings', async () => {
  const settings = State.normalizeSettings({
    selectedChain: 'base', language: 'en', theme: 'light', displayCurrency: 'USD',
    fastMode: true, confirmationEnabled: false, soundEnabled: false, showListQuickBuy: false,
    slippageBps: 123, platformFeeBps: 45,
    chains: {
      eth: { buyPresets: [0.25, 0.5], networkFeeNative: 0.002, initialBalanceNative: 20 },
      bsc: { buyPresets: [1, 2], networkFeeNative: 0.003, initialBalanceNative: 30 }
    }
  });
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const bought = Engine.executeBuy(initial, {
    token: { chain: 'eth', address: '0x7777777777777777777777777777777777777777' },
    quote: { priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000 },
    amountNative: 1
  }, State.normalizeSettings({ ...settings, slippageBps: 0, platformFeeBps: 0, chains: {
    ...settings.chains, eth: { ...settings.chains.eth, networkFeeNative: 0 }
  } }), 1_000).state;
  bought.dailyRealizedByChain.eth['2026-07-22'] = { native: 3, usd: 6_000 };
  bought.calibrations = [{
    id: 'calibration-1', chain: 'eth', tokenAddress: '0x7777777777777777777777777777777777777777',
    reason: 'PRICE', fromPriceUsd: 1, toPriceUsd: 2, fromNativePriceUsd: 2_000,
    toNativePriceUsd: 2_000, fromSupply: 0, toSupply: 0, quantityBefore: 1,
    quantityAfter: 1, costBasisNative: 1, createdAt: 1_000
  }];
  const persistence = memoryPersistence(bought, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const committed = await coordinator.mutate({
    type: 'RESET_ALL_WITH_BALANCE', balanceNative: 42, language: 'zh-CN'
  });

  assert.equal(persistence.writes.length, 1);
  assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
    global.Tango.SETTINGS_KEY,
    global.Tango.STORAGE_KEY
  ].sort());
  assert.equal(committed.state.initialized, true);
  assert.equal(committed.state.stateRevision, bought.stateRevision + 1);
  assert.deepEqual(committed.state.positions, {});
  assert.deepEqual(committed.state.trades, []);
  assert.deepEqual(committed.state.calibrations, []);
  for (const chain of global.Tango.Chains.all()) {
    assert.equal(committed.state.accounts[chain.id].initialBalanceNative, 42, chain.id);
    assert.equal(committed.state.accounts[chain.id].cashBalanceNative, 42, chain.id);
    assert.equal(committed.state.accounts[chain.id].realizedPnlNative, 0, chain.id);
    assert.deepEqual(committed.state.dailyRealizedByChain[chain.id], {}, chain.id);
    assert.equal(committed.settings.chains[chain.id].initialBalanceNative, 42, chain.id);
    assert.deepEqual(committed.settings.chains[chain.id].buyPresets, settings.chains[chain.id].buyPresets, chain.id);
    assert.equal(committed.settings.chains[chain.id].networkFeeNative, settings.chains[chain.id].networkFeeNative, chain.id);
  }
  for (const field of [...GLOBAL_BOOLEAN_FIELDS, ...GLOBAL_ENUM_FIELDS, 'slippageBps', 'platformFeeBps']) {
    assert.equal(committed.settings[field], field === 'language' ? 'zh-CN' : settings[field], field);
  }
});

test('invalid common-capital reset inputs write nothing and do not poison the coordinator queue', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  initial.accounts.eth.cashBalanceNative = 4;
  const settings = State.normalizeSettings({ language: 'en', theme: 'light' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  for (const balanceNative of [0, -1, NaN, Infinity, Number.EPSILON, 1e15 + 1, '10', null]) {
    await assert.rejects(
      coordinator.mutate({ type: 'RESET_ALL_WITH_BALANCE', balanceNative }),
      /invalidResetPrincipal/
    );
    assert.equal(persistence.writes.length, 0, String(balanceNative));
  }
  const rejected = coordinator.mutate({ type: 'RESET_ALL_WITH_BALANCE', balanceNative: Infinity });
  const accepted = coordinator.mutate({ type: 'RESET_ALL_WITH_BALANCE', balanceNative: 25 });
  await assert.rejects(rejected, /invalidResetPrincipal/);
  const committed = await accepted;
  assert.equal(persistence.writes.length, 1);
  assert.equal(committed.state.accounts.eth.cashBalanceNative, 25);
  assert.equal(committed.settings.language, 'en');
});

test('common-capital reset applies submitted settings in the same atomic write', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({ theme: 'dark', displayCurrency: 'NATIVE' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const committed = await coordinator.mutate({
    type: 'RESET_ALL_WITH_BALANCE', balanceNative: 30,
    settingsPatch: { theme: 'light', displayCurrency: 'USD', chains: { eth: { networkFeeNative: 0.123 } } }
  });

  assert.equal(persistence.writes.length, 1);
  assert.equal(committed.settings.theme, 'light');
  assert.equal(committed.settings.displayCurrency, 'USD');
  assert.equal(committed.settings.chains.eth.networkFeeNative, 0.123);
  assert.equal(committed.settings.chains.bsc.networkFeeNative, settings.chains.bsc.networkFeeNative);
  for (const chain of global.Tango.Chains.all()) {
    assert.equal(committed.settings.chains[chain.id].initialBalanceNative, 30, chain.id);
  }
});

test('imports normalize before one queued atomic state-and-settings write', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({ selectedChain: 'eth' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const importedState = State.createInitialState({ now: 100 });
  importedState.initialized = true;
  importedState.accounts.bsc.cashBalanceNative = 7;
  const importedSettings = State.normalizeSettings({ selectedChain: 'base' });
  const payload = {
    product: 'Tango Paper Trader',
    version: '0.3.0',
    exportedAt: 1_500,
    state: importedState,
    settings: importedSettings
  };

  const imported = await coordinator.mutate({ type: 'IMPORT', payload });
  assert.equal(imported.state.accounts.bsc.cashBalanceNative, 7);
  assert.equal(imported.state.stateRevision, 1);
  assert.equal(imported.settings.selectedChain, 'base');

  const invalid = structuredClone(payload);
  invalid.state.positions['wrong-key'] = {
    chain: 'eth', tokenAddress: 'bad', quantity: 1, costBasisNative: 1
  };
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: invalid }), /invalidPosition/);
  const afterFailure = await coordinator.getAll();
  assert.equal(afterFailure.state.accounts.bsc.cashBalanceNative, 7);
  assert.equal(afterFailure.state.stateRevision, 1);
  assert.equal(afterFailure.settings.selectedChain, 'base');

  for (const value of [null, false, '']) {
    const malformedAccount = structuredClone(payload);
    malformedAccount.state.accounts.eth.cashBalanceNative = value;
    await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: malformedAccount }), /invalidAccount/);
    const afterMalformedAccount = await coordinator.getAll();
    assert.equal(afterMalformedAccount.state.accounts.bsc.cashBalanceNative, 7);
    assert.equal(afterMalformedAccount.state.stateRevision, 1);
    assert.equal(afterMalformedAccount.settings.selectedChain, 'base');
  }

  const malformedTrade = structuredClone(payload);
  malformedTrade.state.trades = [{
    id: 'bad', chain: 'eth', tokenAddress: 'bad', side: 'BUY', quantity: -1,
    amountNative: Infinity, observedPriceUsd: 1, executionPriceUsd: 1,
    marketCapUsd: 0, liquidityUsd: 0, nativePriceUsd: 2_000, slippageBps: 0,
    platformFeeNative: 0, networkFeeNative: 0, realizedPnlNative: 0,
    realizedPnlUsd: 0, executedAt: 1
  }];
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: malformedTrade }), /invalidTrade/);

  const unsafeSettings = structuredClone(payload);
  unsafeSettings.settings.chains.eth.networkFeeNative = Infinity;
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: unsafeSettings }), /invalidSettings/);

  const invalidTimestamp = structuredClone(payload);
  invalidTimestamp.exportedAt = Infinity;
  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: invalidTimestamp }), /importFailed/);
  assert.equal((await coordinator.getAll()).state.stateRevision, 1);
});

test('IMPORT rejects every malformed global setting without writes for v1 or v2 and the queue remains usable', async () => {
  const initial = State.createInitialState({ now: 1 });
  initial.initialized = true;
  const settings = State.normalizeSettings({ selectedChain: 'eth', language: 'en' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const v1State = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 10, realizedPnlSol: 0, createdAt: 1, updatedAt: 1 },
    positions: {}, trades: [], dailyRealized: {}, initialized: true
  };
  const snapshots = [
    { label: 'v2', state: initial, settings },
    {
      label: 'v1', state: v1State,
      settings: { buyPresets: [1], sellPresets: [25, 100], networkFeeSol: 0.001, initialBalanceSol: 10 }
    }
  ];
  const beforeState = structuredClone(persistence.values[global.Tango.STORAGE_KEY]);
  const beforeSettings = structuredClone(persistence.values[global.Tango.SETTINGS_KEY]);

  for (const snapshot of snapshots) {
    for (const [field, values] of [
      ...GLOBAL_BOOLEAN_FIELDS.map((field) => [field, [null, 'true']]),
      ...GLOBAL_ENUM_FIELDS.map((field) => [field, [null, 'invalid']])
    ]) {
      for (const value of values) {
        const payload = {
          product: 'Tango Paper Trader', version: 'test', exportedAt: 1_500,
          state: structuredClone(snapshot.state),
          settings: { ...structuredClone(snapshot.settings), [field]: value }
        };
        await assert.rejects(
          coordinator.mutate({ type: 'IMPORT', payload }),
          /invalidSettings/,
          `${snapshot.label} ${field}=${String(value)}`
        );
        assert.equal(persistence.writes.length, 0, `${snapshot.label} ${field} must not write`);
        assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], beforeState);
        assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], beforeSettings);
      }
    }
  }

  const accepted = await coordinator.mutate({ type: 'PATCH_SETTINGS', patch: { selectedChain: 'bsc' } });
  assert.equal(accepted.settings.selectedChain, 'bsc');
  assert.equal(persistence.writes.length, 1);
});

test('malformed IMPORT never persists migration of the current raw v1 snapshot and a later valid import writes once', async () => {
  const currentLegacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: -1, createdAt: 10, updatedAt: 20 },
    positions: {}, trades: [], dailyRealized: { '2026-07-18': -1 }, initialized: true
  };
  const currentSettings = State.normalizeSettings({ selectedChain: 'eth', language: 'en' });
  const importedV2 = State.createInitialState({ now: 100 });
  importedV2.initialized = true;
  importedV2.accounts.bsc.cashBalanceNative = 7;
  const importedV1 = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 8, realizedPnlSol: -2, createdAt: 30, updatedAt: 40 },
    positions: {}, trades: [], dailyRealized: { '2026-07-19': -2 }, initialized: true
  };
  const variants = [
    { label: 'v2', state: importedV2, settings: State.normalizeSettings({ selectedChain: 'base' }) },
    {
      label: 'v1', state: importedV1,
      settings: { selectedChain: 'sol', buyPresets: [1], sellPresets: [25, 100], networkFeeSol: 0.001, initialBalanceSol: 10 }
    }
  ];

  for (const variant of variants) {
    const persistence = memoryPersistence(currentLegacy, currentSettings);
    const coordinator = StateCoordinator.create({
      readRaw: persistence.readRaw,
      writeRaw: persistence.writeRaw,
      now: () => 2_000
    });
    const malformed = {
      product: 'Tango Paper Trader', version: 'test', exportedAt: 1_500,
      state: structuredClone(variant.state),
      settings: { ...structuredClone(variant.settings), enabled: null }
    };

    await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload: malformed }), /invalidSettings/);
    assert.equal(persistence.writes.length, 0, `${variant.label} malformed import must not migrate current storage`);
    assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], currentLegacy);
    assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], currentSettings);

    const valid = structuredClone(malformed);
    valid.settings.enabled = true;
    const imported = await coordinator.mutate({ type: 'IMPORT', payload: valid });

    assert.equal(persistence.writes.length, 1, `${variant.label} valid import writes once`);
    assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
      global.Tango.SETTINGS_KEY,
      global.Tango.STORAGE_KEY
    ].sort());
    assert.equal(imported.state.schemaVersion, 2);
    assert.equal(imported.state.stateRevision, 1);
    assert.equal(imported.settings.enabled, true);
    assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], imported.state);
    assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], imported.settings);
  }
});

test('imports a structurally valid v1 backup and canonicalizes its Solana state', async () => {
  const initial = State.createInitialState({ now: 1 });
  const persistence = memoryPersistence(initial, State.normalizeSettings({}));
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const payload = {
    product: 'Tango Paper Trader', version: '0.2.17', exportedAt: 1_500,
    settings: { buyPresets: [1], networkFeeSol: 0.001, initialBalanceSol: 10 },
    state: {
      schemaVersion: 1,
      account: { initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: 0, createdAt: 10, updatedAt: 20 },
      positions: {},
      trades: [],
      dailyRealized: {},
      initialized: true
    }
  };

  const imported = await coordinator.mutate({ type: 'IMPORT', payload });
  assert.equal(imported.state.schemaVersion, 2);
  assert.equal(imported.state.accounts.sol.cashBalanceNative, 9);
  assert.equal(imported.state.accounts.eth.createdAt, 1_500);
  assert.equal(imported.settings.chains.sol.buyPresets[0], 1);
});

test('reset validates a raw v1 snapshot before one atomic migration-and-reset write', async () => {
  const legacy = {
    schemaVersion: 1,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 9,
      realizedPnlSol: -1,
      createdAt: 10,
      updatedAt: 20
    },
    positions: {},
    trades: [],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({
    selectedChain: 'sol',
    chains: { eth: { initialBalanceNative: 20 }, bsc: { initialBalanceNative: 30 } }
  });
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  await assert.rejects(
    coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: Infinity }),
    /invalidResetPrincipal/
  );
  assert.equal(persistence.writes.length, 0);
  assert.equal(persistence.values[global.Tango.STORAGE_KEY].schemaVersion, 1);

  const committed = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: 42 });
  assert.equal(persistence.writes.length, 1);
  assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
    global.Tango.SETTINGS_KEY,
    global.Tango.STORAGE_KEY
  ].sort());
  assert.equal(committed.state.schemaVersion, 2);
  assert.equal(committed.state.stateRevision, 1);
  assert.equal(committed.state.accounts.eth.cashBalanceNative, 42);
  assert.equal(committed.settings.chains.eth.initialBalanceNative, 42);
});

test('persists one raw v1 migration while holding the coordinator queue', async () => {
  const legacy = {
    schemaVersion: 1,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 9,
      realizedPnlSol: -1,
      createdAt: 10,
      updatedAt: 20
    },
    positions: {},
    trades: [],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({});
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const first = await coordinator.getAll();
  const second = await coordinator.getAll();
  assert.equal(persistence.values[global.Tango.STORAGE_KEY].schemaVersion, 2);
  assert.equal(first.state.accounts.eth.createdAt, 2_000);
  assert.deepEqual(second.state, first.state);
  assert.equal(first.state.stateRevision, 1);
});

test('ordinary raw v1 migration atomically freezes normalized legacy settings for every chain', async () => {
  const legacy = {
    schemaVersion: 1,
    account: {
      initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: -1,
      createdAt: 10, updatedAt: 20
    },
    positions: {}, trades: [], dailyRealized: {}, initialized: true
  };
  const legacySettings = {
    selectedChain: 'sol', language: 'zh-CN', buyPresets: [0.25, 0.75],
    sellPresets: [25, 100], networkFeeSol: 0.0042, initialBalanceSol: 10
  };
  const persistence = memoryPersistence(legacy, legacySettings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const migrated = await coordinator.getAll();

  assert.equal(persistence.writes.length, 1);
  assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
    global.Tango.SETTINGS_KEY,
    global.Tango.STORAGE_KEY
  ].sort());
  assert.deepEqual(migrated.settings.chains.sol.buyPresets, [0.25, 0.75]);
  assert.equal(migrated.settings.chains.sol.networkFeeNative, 0.0042);
  assert.equal(migrated.settings.chains.sol.initialBalanceNative, 10);
  for (const chain of global.Tango.Chains.all().filter(({ id }) => id !== 'sol')) {
    assert.deepEqual(migrated.settings.chains[chain.id].buyPresets, chain.defaultBuyPresets);
    assert.equal(migrated.settings.chains[chain.id].networkFeeNative, chain.defaultNetworkFeeNative);
    assert.equal(migrated.settings.chains[chain.id].initialBalanceNative, 10);
  }
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], migrated.settings);
  await coordinator.getAll();
  assert.equal(persistence.writes.length, 1, 'durable migration must not repeat');
});

test('forged market-cap import writes nothing and does not poison later coordinator work', async () => {
  const initial = State.createInitialState({ now: 1 });
  const settings = State.normalizeSettings({ selectedChain: 'eth' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const imported = State.createInitialState({ now: 100 });
  const address = '9cfBkPsoQ2NPHYPi7b69bcQG8FKfNc33k2UfRxiPpump';
  imported.positions[`sol:${address}`] = {
    chain: 'sol', tokenAddress: address, quantity: 1, costBasisNative: 1,
    realizedPnlNative: 0, averageEntryPriceUsd: 2, averageEntryMarketCap: 2_000,
    lastPriceUsd: 2, lastMarketCapUsd: 2_000, lastNativePriceUsd: 100,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1,
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1', openedAt: 1, updatedAt: 1
  };
  const payload = {
    product: 'Tango Paper Trader', version: 'test', exportedAt: 1_500,
    state: imported, settings: State.normalizeSettings({ selectedChain: 'sol' })
  };

  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload }), /invalidPosition/);
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], initial);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);

  const recovered = await coordinator.mutate({ type: 'PATCH_SETTINGS', patch: { selectedChain: 'bsc' } });
  assert.equal(recovered.settings.selectedChain, 'bsc');
  assert.equal(persistence.writes.length, 1);
});

test('forged trade market-cap provenance writes nothing and does not poison later coordinator work', async () => {
  const initial = State.createInitialState({ now: 1 });
  const settings = State.normalizeSettings({ selectedChain: 'eth' });
  const persistence = memoryPersistence(initial, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });
  const imported = State.createInitialState({ now: 100 });
  imported.trades = [{
    id: 'forged-trade', chain: 'eth',
    tokenAddress: '0xa111111111111111111111111111111111111111',
    side: 'BUY', amountNative: 1, quantity: 100,
    observedPriceUsd: 20, executionPriceUsd: 20, marketCapUsd: 2_000_000,
    liquidityUsd: 500_000, nativePriceUsd: 2_000, nativeSymbol: 'ETH',
    slippageBps: 0, platformFeeNative: 0, networkFeeNative: 0,
    realizedPnlNative: 0, realizedPnlUsd: 0, executedAt: 1_000,
    valuationMode: 'MARKET_CAP', priceProvenance: 'OBSERVED_PRICE',
    marketCapProvenance: 'SOLANA_PUMP_TRENCH_V1'
  }];
  const payload = {
    product: 'Tango Paper Trader', version: 'test', exportedAt: 1_500,
    state: imported, settings: State.normalizeSettings({ selectedChain: 'sol' })
  };

  await assert.rejects(coordinator.mutate({ type: 'IMPORT', payload }), /invalidTrade/);
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], initial);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);

  const recovered = await coordinator.mutate({ type: 'PATCH_SETTINGS', patch: { selectedChain: 'bsc' } });
  assert.equal(recovered.settings.selectedChain, 'bsc');
  assert.equal(persistence.writes.length, 1);
});

test('a near-budget BUY retains the current trade, advances once, and drops only oldest history', async () => {
  const state = storageStateFixture();
  state.stateRevision = 4;
  state.trades = [
    storageTradeFixture({ id: 'newer-history', executedAt: 2_000 }),
    storageTradeFixture({
      id: 'oldest-large-trade',
      executedAt: 1_000,
      sourceUrl: `https://gmgn.ai/${'x'.repeat(4_096)}`
    })
  ];
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const persistence = memoryPersistence(state, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 3_000,
    stateBudgetBytes: stateBytes(state) - 1
  });
  const order = {
    token: {
      chain: 'eth',
      address: '0xc333333333333333333333333333333333333333',
      symbol: 'CURRENT'
    },
    quote: {
      priceUsd: 2,
      nativePriceUsd: 2_000,
      observedAt: 3_000,
      nativePriceObservedAt: 3_000,
      source: 'GMGN_NETWORK',
      valuationMode: 'PRICE',
      priceProvenance: 'OBSERVED_PRICE'
    },
    amountNative: 1
  };

  const result = await coordinator.mutate({ type: 'EXECUTE_BUY', order });

  assert.equal(result.state.stateRevision, 5);
  assert.equal(result.state.trades.some(({ id }) => id === result.trade.id), true);
  assert.equal(result.state.trades.some(({ id }) => id === 'newer-history'), true);
  assert.equal(result.state.trades.some(({ id }) => id === 'oldest-large-trade'), false);
  assert.ok(stateBytes(result.state) <= stateBytes(state) - 1);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], result.state);
  assert.equal(persistence.writes.length, 1);
});

test('oversized IMPORT reports exact bytes and leaves current state and settings unchanged', async () => {
  const current = storageStateFixture();
  const settings = State.normalizeSettings({ selectedChain: 'eth' });
  const imported = storageStateFixture();
  imported.padding = '🔟'.repeat(256);
  const payload = {
    product: 'Tango Paper Trader',
    version: 'test',
    exportedAt: 1_500,
    state: imported,
    settings
  };
  const measuredState = State.normalizeState(imported, settings, { strict: true });
  measuredState.initialized = true;
  measuredState.stateRevision = 1;
  const measuredBytes = stateBytes(measuredState);
  const persistence = memoryPersistence(current, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000,
    stateBudgetBytes: measuredBytes - 1
  });

  await assert.rejects(
    coordinator.mutate({ type: 'IMPORT', payload }),
    (error) => {
      assert.equal(error.code, 'importTooLarge');
      assert.equal(error.measuredBytes, measuredBytes);
      assert.equal(error.budgetBytes, measuredBytes - 1);
      return true;
    }
  );
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], current);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);
});

test('essential-state overflow returns storageFull without a write or revision advance', async () => {
  const current = storageStateFixture();
  current.stateRevision = 7;
  const settings = State.normalizeSettings({});
  const replacement = storageStateFixture();
  replacement.stateRevision = 7;
  replacement.padding = '🔟'.repeat(512);
  const persistence = memoryPersistence(current, settings);
  const budgetBytes = stateBytes(current) + 1;
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    stateBudgetBytes: budgetBytes
  });

  await assert.rejects(
    coordinator.mutate({
      type: 'REPLACE_STATE',
      state: replacement,
      expectedRevision: 7
    }),
    (error) => {
      assert.equal(error.code, 'storageFull');
      assert.ok(error.measuredBytes > budgetBytes);
      assert.equal(error.budgetBytes, budgetBytes);
      return true;
    }
  );
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], current);
});

for (const [name, command] of [
  ['INITIALIZE', { type: 'INITIALIZE', language: 'en', defaultBalanceNative: 10 }],
  ['RESET_ALL_WITH_BALANCE', { type: 'RESET_ALL_WITH_BALANCE', balanceNative: 10 }]
]) {
  test(`${name} applies the byte policy before its direct atomic write`, async () => {
    const current = storageStateFixture();
    current.stateRevision = 9;
    const settings = State.normalizeSettings({});
    const persistence = memoryPersistence(current, settings);
    const coordinator = StateCoordinator.create({
      readRaw: persistence.readRaw,
      writeRaw: persistence.writeRaw,
      now: () => 2_000,
      stateBudgetBytes: 1
    });

    await assert.rejects(
      coordinator.mutate(command),
      (error) => {
        assert.equal(error.code, 'storageFull');
        assert.ok(error.measuredBytes > 1);
        assert.equal(error.budgetBytes, 1);
        return true;
      }
    );
    assert.equal(persistence.writes.length, 0);
    assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], current);
    assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], settings);
  });
}

function rawV1AtomicFixture() {
  return {
    schemaVersion: 1,
    stateRevision: 40,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 9,
      realizedPnlSol: -1,
      createdAt: 10,
      updatedAt: 20
    },
    positions: {},
    trades: [{
      id: 'legacy-large',
      chain: 'sol',
      tokenAddress: 'So11111111111111111111111111111111111111112',
      symbol: 'LEGACY',
      side: 'BUY',
      quantity: 1,
      amountSol: 1,
      observedPriceUsd: 2,
      executionPriceUsd: 2,
      marketCapUsd: 0,
      liquidityUsd: 0,
      solPriceUsd: 100,
      slippageBps: 0,
      platformFeeSol: 0,
      networkFeeSol: 0,
      realizedPnlSol: 0,
      sourceUrl: `https://gmgn.ai/${'x'.repeat(2_048)}`,
      executedAt: 1
    }],
    dailyRealized: {},
    initialized: true
  };
}

const rawV1AtomicCommands = [
  {
    name: 'INITIALIZE',
    command: { type: 'INITIALIZE', language: 'zh-CN', defaultBalanceNative: 42 },
    matchesRequested: (values) => values[global.Tango.SETTINGS_KEY]?.language === 'zh-CN',
    assertRequested(result) {
      assert.equal(result.settings.language, 'zh-CN');
      assert.equal(result.state.accounts.eth.cashBalanceNative, 42);
      assert.equal(result.state.stateRevision, 42);
    }
  },
  {
    name: 'SAVE_SETTINGS',
    command: {
      type: 'SAVE_SETTINGS',
      settings: State.normalizeSettings({ selectedChain: 'bsc', language: 'zh-CN' })
    },
    matchesRequested: (values) => values[global.Tango.SETTINGS_KEY]?.selectedChain === 'bsc',
    assertRequested(result) {
      assert.equal(result.settings.selectedChain, 'bsc');
      assert.equal(result.settings.language, 'zh-CN');
      assert.equal(result.state.stateRevision, 41);
    }
  },
  {
    name: 'PATCH_SETTINGS',
    command: { type: 'PATCH_SETTINGS', patch: { selectedChain: 'base', language: 'zh-CN' } },
    matchesRequested: (values) => values[global.Tango.SETTINGS_KEY]?.selectedChain === 'base',
    assertRequested(result) {
      assert.equal(result.settings.selectedChain, 'base');
      assert.equal(result.settings.language, 'zh-CN');
      assert.equal(result.state.stateRevision, 41);
    }
  }
];

for (const { name, command, matchesRequested, assertRequested } of rawV1AtomicCommands) {
  test(`raw v1 ${name} folds migration and the requested result into one compacted write`, async () => {
    const legacy = rawV1AtomicFixture();
    const legacySettings = {
      selectedChain: 'sol',
      language: 'en',
      buyPresets: [0.25, 0.75],
      sellPresets: [25, 100],
      networkFeeSol: 0.0042,
      initialBalanceSol: 10
    };
    const normalizedSettings = State.normalizeSettings(legacySettings);
    const compactedMigration = State.normalizeState(legacy, normalizedSettings, { migrationNow: 2_000 });
    compactedMigration.stateRevision = 41;
    compactedMigration.trades = [];
    const initialized = State.createInitialState({
      now: 2_000,
      initialBalances: Object.fromEntries(global.Tango.Chains.all().map((chain) => [chain.id, 42]))
    });
    initialized.initialized = true;
    initialized.stateRevision = 42;
    const budgetBytes = Math.max(stateBytes(compactedMigration), stateBytes(initialized));
    const persistence = memoryPersistence(legacy, legacySettings);
    const coordinator = StateCoordinator.create({
      readRaw: persistence.readRaw,
      writeRaw: persistence.writeRaw,
      now: () => 2_000,
      stateBudgetBytes: budgetBytes
    });

    const result = await coordinator.mutate(command);

    assert.equal(persistence.writes.length, 1);
    assert.deepEqual(Object.keys(persistence.writes[0]).sort(), [
      global.Tango.SETTINGS_KEY,
      global.Tango.STORAGE_KEY
    ].sort());
    assert.equal(matchesRequested(persistence.writes[0]), true);
    assert.deepEqual(persistence.writes[0][global.Tango.STORAGE_KEY], result.state);
    assert.deepEqual(persistence.writes[0][global.Tango.SETTINGS_KEY], result.settings);
    assert.ok(stateBytes(result.state) <= budgetBytes);
    if (name !== 'INITIALIZE') {
      assert.equal(result.state.trades.some(({ id }) => id === 'legacy-large'), false);
    }
    assertRequested(result);
  });

  test(`raw v1 ${name} quota failure leaves migration and requested data wholly unpersisted`, async () => {
    const legacy = rawV1AtomicFixture();
    const legacySettings = {
      selectedChain: 'sol',
      language: 'en',
      buyPresets: [0.25, 0.75],
      sellPresets: [25, 100],
      networkFeeSol: 0.0042,
      initialBalanceSol: 10
    };
    const persistence = memoryPersistence(legacy, legacySettings);
    const successfulWrites = [];
    let attempts = 0;
    const writeRaw = async (values) => {
      attempts += 1;
      if (matchesRequested(values)) {
        const error = new Error('QUOTA_BYTES quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      successfulWrites.push(structuredClone(values));
      Object.assign(persistence.values, structuredClone(values));
    };
    const coordinator = StateCoordinator.create({
      readRaw: persistence.readRaw,
      writeRaw,
      now: () => 2_000
    });

    await assert.rejects(
      coordinator.mutate(command),
      (error) => error.code === 'storageFull'
    );

    assert.equal(attempts, 1);
    assert.equal(successfulWrites.length, 0);
    assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], legacy);
    assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], legacySettings);
  });
}

test('raw v1 migration compacts before its one atomic migration write', async () => {
  const address = 'So11111111111111111111111111111111111111112';
  const legacy = {
    schemaVersion: 1,
    stateRevision: 0,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 10,
      realizedPnlSol: 0,
      createdAt: 1,
      updatedAt: 1
    },
    positions: {},
    trades: [{
      id: 'legacy-large',
      chain: 'sol',
      tokenAddress: address,
      symbol: 'LEGACY',
      side: 'BUY',
      quantity: 1,
      amountSol: 1,
      observedPriceUsd: 2,
      executionPriceUsd: 2,
      marketCapUsd: 0,
      liquidityUsd: 0,
      solPriceUsd: 100,
      slippageBps: 0,
      platformFeeSol: 0,
      networkFeeSol: 0,
      realizedPnlSol: 0,
      sourceUrl: `https://gmgn.ai/${'x'.repeat(2_048)}`,
      executedAt: 1
    }],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({});
  const expected = State.normalizeState(legacy, settings, { migrationNow: 2_000 });
  expected.stateRevision = 1;
  expected.trades = [];
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000,
    stateBudgetBytes: stateBytes(expected)
  });

  const migrated = await coordinator.getAll();

  assert.deepEqual(migrated.state, expected);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], expected);
  assert.equal(persistence.writes.length, 1);
});

test('raw v1 REPLACE_STATE budget overflow rejects before migration writes or revision advances', async () => {
  const legacy = {
    schemaVersion: 1,
    stateRevision: 4,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 10,
      realizedPnlSol: 0,
      createdAt: 1,
      updatedAt: 1
    },
    positions: {},
    trades: [],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({});
  const original = structuredClone(legacy);
  const replacement = storageStateFixture();
  replacement.padding = '🔟'.repeat(512);
  const normalizedLegacy = State.normalizeState(legacy, settings, { migrationNow: 2_000 });
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000,
    stateBudgetBytes: stateBytes(normalizedLegacy) + 1
  });

  await assert.rejects(
    coordinator.mutate({
      type: 'REPLACE_STATE',
      state: replacement,
      expectedRevision: 5
    }),
    (error) => {
      assert.equal(error.code, 'storageFull');
      return true;
    }
  );
  assert.equal(persistence.writes.length, 0);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], original);
  assert.equal(persistence.values[global.Tango.STORAGE_KEY].stateRevision, 4);
});

test('a successful generic mutation on raw v1 commits migration only in its final atomic write', async () => {
  const legacy = {
    schemaVersion: 1,
    stateRevision: 4,
    account: {
      initialBalanceSol: 10,
      cashBalanceSol: 10,
      realizedPnlSol: 0,
      createdAt: 1,
      updatedAt: 1
    },
    positions: {},
    trades: [],
    dailyRealized: {},
    initialized: true
  };
  const settings = State.normalizeSettings({});
  const replacement = State.normalizeState(legacy, settings, { migrationNow: 2_000 });
  const persistence = memoryPersistence(legacy, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 2_000
  });

  const result = await coordinator.mutate({
    type: 'REPLACE_STATE',
    state: replacement,
    expectedRevision: 5
  });

  assert.equal(persistence.writes.length, 1);
  assert.equal(result.state.schemaVersion, 2);
  assert.equal(result.state.stateRevision, 6);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], result.state);
});

test('RESET_CHAIN compacts retained history from other chains before its atomic state-and-settings write', async () => {
  const state = storageStateFixture();
  state.trades = [
    { ...storageTradeFixture({ id: 'bsc-old', executedAt: 1_000, sourceUrl: 'x'.repeat(2_048) }),
      chain: 'bsc', tokenAddress: '0xd444444444444444444444444444444444444444', nativeSymbol: 'BNB' },
    storageTradeFixture({ id: 'eth-reset-away', executedAt: 2_000 })
  ];
  const settings = State.normalizeSettings({});
  const expectedEssential = State.resetChain(state, 'eth', 42, 3_000);
  expectedEssential.trades = [];
  expectedEssential.stateRevision = state.stateRevision + 1;
  const persistence = memoryPersistence(state, settings);
  const coordinator = StateCoordinator.create({
    readRaw: persistence.readRaw,
    writeRaw: persistence.writeRaw,
    now: () => 3_000,
    stateBudgetBytes: stateBytes(expectedEssential)
  });

  const result = await coordinator.mutate({ type: 'RESET_CHAIN', chain: 'eth', balanceNative: 42 });

  assert.deepEqual(result.state, expectedEssential);
  assert.equal(result.settings.chains.eth.initialBalanceNative, 42);
  assert.deepEqual(persistence.values[global.Tango.STORAGE_KEY], result.state);
  assert.deepEqual(persistence.values[global.Tango.SETTINGS_KEY], result.settings);
  assert.equal(persistence.writes.length, 1);
});

test('representative 10k trade plus 10k calibration state commits below 8 MiB under a 10 MiB quota', async () => {
  const state = storageStateFixture();
  state.trades = Array.from({ length: 10_000 }, (_, index) => storageTradeFixture({
    id: `trade-${String(index).padStart(5, '0')}`,
    executedAt: index + 1,
    sourceUrl: `https://gmgn.ai/${'x'.repeat(700)}`
  }));
  state.calibrations = Array.from({ length: 10_000 }, (_, index) => storageCalibrationFixture({
    id: `cal-${String(index).padStart(5, '0')}`,
    createdAt: index + 1
  }));
  const settings = State.normalizeSettings({
    slippageBps: 0,
    platformFeeBps: 0,
    chains: { eth: { networkFeeNative: 0 } }
  });
  const values = {
    [global.Tango.STORAGE_KEY]: structuredClone(state),
    [global.Tango.SETTINGS_KEY]: structuredClone(settings)
  };
  const writes = [];
  const quotaBytes = 10 * 1024 * 1024;
  const readRaw = async (keys) => Object.fromEntries(
    keys.filter((key) => key in values).map((key) => [key, structuredClone(values[key])])
  );
  const writeRaw = async (next) => {
    const merged = { ...values, ...structuredClone(next) };
    if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > quotaBytes) {
      const error = new Error('QUOTA_BYTES quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    writes.push(structuredClone(next));
    Object.assign(values, structuredClone(next));
  };
  assert.ok(stateBytes(state) > quotaBytes);
  await assert.rejects(writeRaw({ [global.Tango.STORAGE_KEY]: state }), /QUOTA_BYTES/);
  const coordinator = StateCoordinator.create({ readRaw, writeRaw, now: () => 20_000 });

  const result = await coordinator.mutate({
    type: 'EXECUTE_BUY',
    order: {
      token: {
        chain: 'eth',
        address: '0xe555555555555555555555555555555555555555',
        symbol: 'CURRENT'
      },
      quote: {
        priceUsd: 2,
        nativePriceUsd: 2_000,
        observedAt: 20_000,
        nativePriceObservedAt: 20_000,
        source: 'GMGN_NETWORK',
        valuationMode: 'PRICE',
        priceProvenance: 'OBSERVED_PRICE'
      },
      amountNative: 1
    }
  });

  assert.ok(stateBytes(result.state) <= 8 * 1024 * 1024);
  assert.equal(result.state.trades.some(({ id }) => id === result.trade.id), true);
  assert.deepEqual(values[global.Tango.STORAGE_KEY], result.state);
  assert.equal(writes.length, 1);
});
