const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/core/chains.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');

const PUMP_ADDRESS = '11111111111111111111111111111111pump';

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

test('v1 migration backfills trusted provenance for a coherent legacy Pump position', () => {
  const key = `sol:${PUMP_ADDRESS.toLowerCase()}`;
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 9, realizedPnlSol: 0 },
    positions: { [key]: legacyMarketCapPosition() },
    trades: [], dailyRealized: {}, initialized: true
  };
  const migrated = State.normalizeState(legacy, State.normalizeSettings({}));
  assert.equal(migrated.positions[key].marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');

  const freshQuote = {
    priceUsd: 0, marketCapUsd: 6_000, nativePriceUsd: 100, observedAt: 2_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const sold = Engine.executeSell(migrated, {
    token: { chain: 'sol', address: PUMP_ADDRESS }, quote: freshQuote, percent: 10
  }, State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, networkFeeSol: 0 }), 2_000);
  assert.equal(sold.trade.observedPriceUsd, 0.000006);
  assert.ok(sold.trade.amountNative > 0);
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
    'sol:22222222222222222222222222222222pump': legacyMarketCapPosition({
      tokenAddress: '22222222222222222222222222222222pump', costBasisNative: 1,
      marketCapDivisor: 1_000_000
    }),
    'sol:33333333333333333333333333333333pump': legacyMarketCapPosition({
      tokenAddress: '33333333333333333333333333333333pump', costBasisNative: 1,
      averageEntryPriceUsd: 2, lastPriceUsd: 2
    }),
    'sol:44444444444444444444444444444444pump': legacyMarketCapPosition({
      tokenAddress: '44444444444444444444444444444444pump', costBasisNative: Infinity
    }),
    'sol:55555555555555555555555555555555pump': legacyMarketCapPosition({
      tokenAddress: '55555555555555555555555555555555pump', costBasisNative: 1,
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
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100, observedAt: 1_000,
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
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100, observedAt: 1_000,
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

test('settings move legacy Solana values into the Solana chain only', () => {
  const settings = State.normalizeSettings({ buyPresets: [1, 2], networkFeeSol: 0.002, initialBalanceSol: 25 });
  assert.deepEqual(settings.chains.sol.buyPresets, [1, 2]);
  assert.equal(settings.chains.sol.networkFeeNative, 0.002);
  assert.equal(settings.chains.sol.initialBalanceNative, 25);
  assert.equal(Object.hasOwn(settings, 'buyPresets'), false);
  assert.equal(Object.hasOwn(settings, 'networkFeeSol'), false);
  assert.equal(Object.hasOwn(settings, 'initialBalanceSol'), false);
});

test('v2 trade normalization derives the registered chain native symbol', () => {
  const state = State.createInitialState({ now: 1000 });
  state.trades = [{ id: 'bsc-1', chain: 'bsc', amountNative: 1 }];
  const normalized = State.normalizeState(state, State.normalizeSettings({}));
  assert.equal(normalized.trades[0].nativeSymbol, 'BNB');
});

test('strict v2 import rejects an inconsistent native symbol and repairs a missing one', () => {
  const state = State.createInitialState({ now: 1000 });
  state.trades = [{ id: 'bsc-1', chain: 'bsc', amountNative: 1, nativeSymbol: 'SOL' }];
  assert.throws(() => State.normalizeState(state, State.normalizeSettings({}), { strict: true }), /invalidTrade/);
  state.trades[0] = { id: 'bsc-1', chain: 'bsc', amountNative: 1 };
  const normalized = State.normalizeState(state, State.normalizeSettings({}), { strict: true });
  assert.equal(normalized.trades[0].nativeSymbol, 'BNB');
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

test('strict v1 import rejects an invalid legacy position', () => {
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: 10, realizedPnlSol: 0 },
    positions: { invalid: { chain: 'unknown', tokenAddress: 'not-an-address', quantity: 1 } }
  };
  assert.throws(() => State.normalizeState(legacy, State.normalizeSettings({}), { strict: true }), /invalidPosition/);
});

test('strict v1 import rejects a non-finite legacy balance', () => {
  const legacy = {
    schemaVersion: 1,
    account: { initialBalanceSol: 10, cashBalanceSol: Infinity, realizedPnlSol: 0 }
  };
  assert.throws(() => State.normalizeState(legacy, State.normalizeSettings({}), { strict: true }), /invalidAccount/);
});
