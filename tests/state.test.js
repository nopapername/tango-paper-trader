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
