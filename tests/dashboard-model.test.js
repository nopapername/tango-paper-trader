const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
require('../src/shared/constants.js');
require('../src/core/state.js');
require('../src/core/engine.js');
require('../src/content/chain-view.js');
const DashboardModel = require('../src/dashboard/model.js');

const ETH_ADDRESS = '0x1111111111111111111111111111111111111111';
const BSC_ADDRESS = '0x2222222222222222222222222222222222222222';

function fixture() {
  const state = Tango.State.createInitialState({ now: Date.UTC(2026, 6, 1) });
  state.initialized = true;
  state.positions = {
    [`eth:${ETH_ADDRESS}`]: {
      chain: 'eth', tokenAddress: ETH_ADDRESS, symbol: 'ETHY', quantity: 1,
      costBasisNative: 1, lastPriceUsd: 2_000, lastNativePriceUsd: 2_000
    },
    [`bsc:${BSC_ADDRESS}`]: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, symbol: 'BSCY', quantity: 1,
      costBasisNative: 2, lastPriceUsd: 600, lastNativePriceUsd: 300
    }
  };
  state.trades = [
    {
      id: 'eth-trade', executedAt: Date.UTC(2026, 6, 18, 12), chain: 'eth', nativeSymbol: 'ETH',
      tokenAddress: ETH_ADDRESS, symbol: 'ETHY', side: 'SELL', amountNative: 1, quantity: 1,
      observedPriceUsd: 1_900, executionPriceUsd: 2_000, marketCapUsd: 2_000_000,
      nativePriceUsd: 2_000, slippageBps: 50, platformFeeNative: 0.01,
      networkFeeNative: 0.001, realizedPnlNative: 1, realizedPnlUsd: 2_000,
      sourceUrl: 'https://gmgn.ai/eth/token/example'
    },
    {
      id: 'bsc-trade', executedAt: Date.UTC(2026, 6, 18, 13), chain: 'bsc', nativeSymbol: 'BNB',
      tokenAddress: BSC_ADDRESS, symbol: 'BSCY', side: 'SELL', amountNative: 2, quantity: 1,
      observedPriceUsd: 550, executionPriceUsd: 600, marketCapUsd: 600_000,
      nativePriceUsd: 300, slippageBps: 50, platformFeeNative: 0.02,
      networkFeeNative: 0.001, realizedPnlNative: -1, realizedPnlUsd: -300,
      sourceUrl: 'https://gmgn.ai/bsc/token/example'
    }
  ];
  state.accounts.eth = { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: 1 };
  state.accounts.bsc = { initialBalanceNative: 10, cashBalanceNative: 10, realizedPnlNative: -1 };
  state.dailyRealizedByChain.eth['2026-07-18'] = { native: 1, usdAtExecution: 2_000 };
  state.dailyRealizedByChain.bsc['2026-07-18'] = { native: -1, usdAtExecution: -300 };
  return state;
}

const settings = Tango.State.normalizeSettings({
  selectedChain: 'eth',
  chains: {
    eth: { buyPresets: [0.1, 1], networkFeeNative: 0.002 },
    bsc: { buyPresets: [0.2, 2], networkFeeNative: 0.003 }
  }
});

test('Dashboard operational collections contain only the selected chain', () => {
  const model = DashboardModel.build(fixture(), settings, 'bsc', { eth: 2_000, bsc: 300 }, {
    search: '', side: 'ALL', result: 'ALL', date: ''
  });
  assert.equal(model.positions.every((position) => position.chain === 'bsc'), true);
  assert.equal(model.trades.every((trade) => trade.chain === 'bsc'), true);
  assert.equal(model.chain.id, 'bsc');
  assert.deepEqual(model.chainSettings.buyPresets, [0.2, 2]);
});

test('Dashboard filters only the selected chain collection', () => {
  const state = fixture();
  const model = DashboardModel.build(state, settings, 'eth', {}, {
    search: 'ethy', side: 'SELL', result: 'WIN', date: '2026-07-18'
  });
  assert.deepEqual(model.trades.map((trade) => trade.id), ['eth-trade']);
  assert.equal(state.trades.length, 2, 'building the view must not mutate full state');
});

test('CSV rows contain only the selected chain and native fields', () => {
  const rows = DashboardModel.tradesCsvRows(fixture(), 'eth');
  assert.equal(rows.every((row) => row.chain === 'eth'), true);
  assert.equal(Object.keys(rows[0]).includes('nativePriceUsd'), true);
  assert.equal(Object.keys(rows[0]).includes('realizedPnlNative'), true);
  assert.deepEqual(Object.keys(rows[0]), [
    'executedAt', 'chain', 'nativeSymbol', 'tokenAddress', 'symbol', 'side', 'amountNative',
    'quantity', 'observedPriceUsd', 'executionPriceUsd', 'marketCapUsd', 'nativePriceUsd',
    'slippageBps', 'platformFeeNative', 'networkFeeNative', 'realizedPnlNative',
    'realizedPnlUsd', 'sourceUrl'
  ]);
});

test('calendar values are selected-chain-only', () => {
  const view = DashboardModel.calendar(fixture(), 'eth', 2026, 6);
  assert.equal(view.days['2026-07-18'].native, 1);
  assert.equal(view.days['2026-07-18'].usdAtExecution, 2_000);
  assert.equal(view.trades.length, 1);
  assert.equal(view.totalNative, 1);
});

test('unsupported operational chain falls back to Solana and never creates ALL', () => {
  const model = DashboardModel.build(fixture(), settings, 'ALL', {}, {});
  assert.equal(model.chain.id, 'sol');
  assert.deepEqual(model.positions, []);
  assert.deepEqual(model.trades, []);
});
