const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
require('../src/core/supply.js');
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

test('Dashboard global USD exactly sums the canonical USD totals displayed by its priced chain cards', () => {
  const prices = { eth: 1_000, bsc: 500 };
  const model = DashboardModel.build(fixture(), settings, 'eth', prices, {});
  const pricedCards = model.accounts.filter(({ nativePriceUsd }) => nativePriceUsd > 0);
  const expectedAssetsUsd = pricedCards.reduce((sum, card) => sum + card.usdSummary.assetsUsd, 0);
  const expectedPnlUsd = pricedCards.reduce((sum, card) => sum + card.usdSummary.pnlUsd, 0);

  assert.equal(model.accounts.find(({ chain }) => chain.id === 'eth').usdSummary.assetsUsd, 12_000);
  assert.equal(model.accounts.find(({ chain }) => chain.id === 'bsc').usdSummary.assetsUsd, 5_600);
  assert.equal(model.globalUsd.assetsUsd, expectedAssetsUsd);
  assert.equal(model.globalUsd.pnlUsd, expectedPnlUsd);
  assert.equal(model.globalUsd.complete, false);
  assert.deepEqual(model.globalUsd.missingChains, ['sol', 'base', 'robinhood', 'xlayer']);
});

test('Dashboard retains finite partial USD totals when one finite provider price overflows its account conversion', () => {
  const prices = Object.fromEntries(Tango.Chains.all().map(chain => [chain.id, 1]));
  prices.eth = 1e308;
  const state = Tango.State.createInitialState();
  state.initialized = true;
  const model = DashboardModel.build(state, settings, 'eth', prices);
  const eth = model.accounts.find(({ chain }) => chain.id === 'eth');
  assert.equal(eth.usdSummary, null);
  assert.equal(eth.summary.equityNative, 10);
  assert.equal(model.summary.equityNative, 10);
  assert.deepEqual(model.globalUsd.missingChains, ['eth']);
  assert.equal(model.globalUsd.complete, false);
  assert.equal(model.globalUsd.assetsUsd, 50);
  assert.equal(model.globalUsd.pnlUsd, 0);
  assert.ok(model.accounts.filter(({ chain }) => chain.id !== 'eth').every(card => card.usdSummary.assetsUsd === 10));
});

test('Dashboard excludes nonfinite native prices from card USD summaries without hiding unrelated engine errors', () => {
  const state = Tango.State.createInitialState();
  const model = DashboardModel.build(state, settings, 'eth', { eth: Infinity, bsc: 1 });
  assert.equal(model.accounts.find(({ chain }) => chain.id === 'eth').usdSummary, null);
  assert.ok(Number.isFinite(model.globalUsd.assetsUsd) && Number.isFinite(model.globalUsd.pnlUsd));
  const original = Tango.Engine.chainUsdSummary;
  try {
    Tango.Engine.chainUsdSummary = (...args) => {
      if (args[1] === 'eth') throw new Error('unexpectedSummaryFailure');
      return original(...args);
    };
    assert.throws(() => DashboardModel.build(state, settings, 'eth', { eth: 1 }), /unexpectedSummaryFailure/);
  } finally { Tango.Engine.chainUsdSummary = original; }
});

test('Dashboard selected and account-card native summaries use each current native price', () => {
  const model = DashboardModel.build(fixture(), settings, 'eth', { eth: 1_000, bsc: 600 }, {});

  assert.equal(model.summary.positionsValueNative, 2);
  assert.equal(model.summary.equityNative, 12);
  const eth = model.accounts.find(({ chain }) => chain.id === 'eth');
  const bsc = model.accounts.find(({ chain }) => chain.id === 'bsc');
  assert.equal(eth.summary.positionsValueNative, 2);
  assert.equal(bsc.summary.positionsValueNative, 1);
});

test('CSV preserves real prices for explicit PRICE provenance despite a one-billion supply ratio', () => {
  const state = fixture();
  state.trades[0] = {
    ...state.trades[0], observedPriceUsd: 2, executionPriceUsd: 2.1,
    marketCapUsd: 2_000_000_000, valuationMode: 'PRICE', priceProvenance: 'OBSERVED_PRICE'
  };
  const row = DashboardModel.tradesCsvRows(state, 'eth')[0];
  assert.equal(row.observedPriceUsd, 2);
  assert.equal(row.executionPriceUsd, 2.1);
});

test('CSV explicit observed-price provenance overrides a stale market-cap mode', () => {
  const state = fixture();
  state.trades[0] = {
    ...state.trades[0], observedPriceUsd: 2, executionPriceUsd: 2.1,
    marketCapUsd: 2_000_000_000, valuationMode: 'MARKET_CAP', priceProvenance: 'OBSERVED_PRICE'
  };

  const row = DashboardModel.tradesCsvRows(state, 'eth')[0];

  assert.equal(row.observedPriceUsd, 2);
  assert.equal(row.executionPriceUsd, 2.1);
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
    'realizedPnlUsd', 'valuationMode', 'priceProvenance', 'quoteSource', 'paperFallback',
    'provisional', 'syntheticTokenPrice', 'syntheticNativePrice', 'totalSupply', 'supplySource',
    'launchpad', 'launchMode', 'sourceUrl'
  ]);
});

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

test('CSV labels market-cap-derived valuation without exporting its synthetic price', () => {
  const state = fixture();
  state.trades[0] = {
    ...state.trades[0], chain: 'sol', tokenAddress: 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP',
    nativeSymbol: 'SOL', observedPriceUsd: 0.000003, executionPriceUsd: 0.0000031,
    marketCapUsd: 3_000, valuationMode: 'MARKET_CAP', priceProvenance: 'MARKET_CAP_DERIVED'
  };
  const row = DashboardModel.tradesCsvRows(state, 'sol')[0];
  assert.equal(row.observedPriceUsd, '');
  assert.equal(row.executionPriceUsd, '');
  assert.equal(row.marketCapUsd, 3_000);
  assert.equal(row.valuationMode, 'MARKET_CAP');
  assert.equal(row.priceProvenance, 'MARKET_CAP_DERIVED');
});

test('calendar values are selected-chain-only', () => {
  const view = DashboardModel.calendar(fixture(), 'eth', 2026, 6);
  assert.equal(view.days['2026-07-18'].native, 1);
  assert.equal(view.days['2026-07-18'].usdAtExecution, 2_000);
  assert.equal(view.trades.length, 1);
  assert.equal(view.totalNative, 1);
});

test('calendar monthly PnL preserves daily aggregates after retained history is removed', () => {
  const state = fixture();
  state.trades = [];
  state.dailyRealizedByChain.eth['2026-07-19'] = { native: -0.25, usdAtExecution: -500 };
  const view = DashboardModel.calendar(state, 'eth', 2026, 6);
  assert.equal(view.totalNative, 0.75);
  assert.equal(view.trades.length, 0);
  assert.equal(view.winRate, 0);
  assert.equal(view.statisticsScope, 'retainedHistory');
});

test('unsupported operational chain falls back to Solana and never creates ALL', () => {
  const model = DashboardModel.build(fixture(), settings, 'ALL', {}, {});
  assert.equal(model.chain.id, 'sol');
  assert.deepEqual(model.positions, []);
  assert.deepEqual(model.trades, []);
});
