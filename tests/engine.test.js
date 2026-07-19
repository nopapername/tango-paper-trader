const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');

function state(balance = 100) {
  const value = State.createInitialState({ now: 1, initialBalances: { sol: balance } });
  value.initialized = true;
  return value;
}

const settings = State.normalizeSettings({
  slippageBps: 100,
  platformFeeBps: 100,
  chains: { sol: { networkFeeNative: 0.001 } }
});
const token = {
  chain: 'sol', address: '11111111111111111111111111111112', symbol: 'TANGO', name: 'Tango',
  metadataVerified: true, metadataSource: 'GMGN_DETAIL'
};
const quote = {
  priceUsd: 2, marketCapUsd: 2_000_000, liquidityUsd: 500_000,
  nativePriceUsd: 100, observedAt: 1_000, nativePriceObservedAt: 1_000
};

test('position keys preserve Solana case, normalize EVM case, and reject invalid identity', () => {
  const solanaAddress = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
  assert.notEqual(Engine.positionKey('sol', solanaAddress), Engine.positionKey('sol', solanaAddress.toLowerCase()));
  assert.equal(
    Engine.positionKey('eth', '0xA111111111111111111111111111111111111111'),
    'eth:0xa111111111111111111111111111111111111111'
  );
  assert.throws(() => Engine.positionKey('eth', 'bad'), /invalidAddress/);
  assert.throws(() => Engine.positionKey('wat', solanaAddress), /unsupportedChain/);
});

test('buy reduces the requested chain cash and creates a weighted native position', () => {
  const first = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  assert.equal(first.state.accounts.sol.cashBalanceNative, 90);
  assert.equal(first.position.costBasisNative, 10);
  assert.ok(first.position.quantity > 0);
  assert.equal(first.trade.side, 'BUY');
  assert.equal(first.trade.nativeSymbol, 'SOL');

  const secondQuote = { ...quote, priceUsd: 4, marketCapUsd: 4_000_000, observedAt: 2_000 };
  const second = Engine.executeBuy(first.state, { token, quote: secondQuote, amountNative: 10 }, settings, 2_000);
  assert.equal(second.state.accounts.sol.cashBalanceNative, 80);
  assert.equal(second.position.costBasisNative, 20);
  assert.ok(second.position.averageEntryPriceUsd > 2 && second.position.averageEntryPriceUsd < 4.1);
});

test('partial sell preserves native cost basis and realizes native and USD pnl', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  const sellQuote = { ...quote, priceUsd: 4, marketCapUsd: 4_000_000, observedAt: 2_000 };
  const sold = Engine.executeSell(bought.state, { token, quote: sellQuote, percent: 50 }, settings, 2_000);
  const key = Engine.positionKey('sol', token.address);
  assert.ok(sold.state.positions[key]);
  assert.ok(Math.abs(sold.state.positions[key].costBasisNative - 5) < 1e-9);
  assert.ok(sold.trade.realizedPnlNative > 0);
  assert.ok(Math.abs(sold.trade.realizedPnlUsd - sold.trade.realizedPnlNative * sellQuote.nativePriceUsd) < 1e-8);
  assert.equal(sold.trade.side, 'SELL');
});

test('full sell removes a position and updates per-chain daily realized pnl', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  const sold = Engine.executeSell(bought.state, { token, quote: { ...quote, priceUsd: 3, observedAt: 2_000 }, percent: 100 }, settings, 2_000);
  assert.equal(Object.keys(sold.state.positions).length, 0);
  assert.ok(Object.values(sold.state.dailyRealizedByChain.sol).some((value) => value.native !== 0));
});

test('the same EVM address remains isolated across chain accounts', () => {
  const address = '0x1111111111111111111111111111111111111111';
  let next = State.createInitialState({ now: 1 }); next.initialized = true;
  const chainSettings = State.normalizeSettings({});
  const evmQuote = {
    priceUsd: 2, marketCapUsd: 2_000_000, nativePriceUsd: 2000,
    observedAt: 1000, nativePriceObservedAt: 1000
  };
  next = Engine.executeBuy(next, { token: { chain: 'eth', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 1 }, chainSettings, 1000).state;
  next = Engine.executeBuy(next, { token: { chain: 'base', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 2 }, chainSettings, 1000).state;
  assert.equal(next.accounts.eth.cashBalanceNative, 9);
  assert.equal(next.accounts.base.cashBalanceNative, 8);
  assert.notEqual(next.positions[`eth:${address}`].costBasisNative, next.positions[`base:${address}`].costBasisNative);
});

test('close all only closes orders for the requested chain', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmQuote = {
    priceUsd: 2, marketCapUsd: 2_000_000, nativePriceUsd: 2000,
    observedAt: 1000, nativePriceObservedAt: 1000
  };
  let next = State.createInitialState({ now: 1 }); next.initialized = true;
  next = Engine.executeBuy(next, { token: { chain: 'eth', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 1 }, settings, 1000).state;
  next = Engine.executeBuy(next, { token: { chain: 'bsc', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 1 }, settings, 1000).state;
  const result = Engine.executeCloseAll(next, 'eth', [
    { token: { chain: 'eth', address, symbol: 'AAA' }, quote: { ...evmQuote, observedAt: 2000 } },
    { token: { chain: 'bsc', address, symbol: 'AAA' }, quote: { ...evmQuote, observedAt: 2000 } }
  ], settings, 2000);
  assert.equal(Object.values(result.state.positions).some((position) => position.chain === 'eth'), false);
  assert.equal(Object.values(result.state.positions).some((position) => position.chain === 'bsc'), true);
  assert.equal(result.failures.length, 1);
});

test('verified Solana Pump market-cap quotes can buy and track native pnl without a token price', () => {
  const pumpToken = {
    ...token,
    address: '11111111111111111111111111111111pump',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const bought = Engine.executeBuy(state(), { token: pumpToken, quote: marketCapQuote, amountNative: 1 }, settings, 1_000);
  assert.equal(bought.position.valuationMode, 'MARKET_CAP');
  assert.equal(bought.trade.valuationMode, 'MARKET_CAP');
  assert.equal(bought.trade.priceProvenance, 'MARKET_CAP_DERIVED');
  assert.equal(bought.trade.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  const doubled = { ...marketCapQuote, marketCapUsd: 6_000, observedAt: 2_000 };
  const mark = Engine.markPosition(bought.position, doubled);
  assert.ok(mark.valueNative > bought.position.costBasisNative * 1.9);
  assert.ok(Engine.executeSell(bought.state, { token: pumpToken, quote: doubled, percent: 100 }, settings, 2_000).trade.realizedPnlNative > 0);
});

test('EVM market-cap-only observations cannot execute through the engine', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmToken = { chain: 'eth', address, symbol: 'AAA' };
  const marketCapOnly = {
    priceUsd: 0,
    marketCapUsd: 2_000_000,
    nativePriceUsd: 2_000,
    observedAt: 1_000,
    source: 'GMGN_NETWORK',
    valuationMode: 'MARKET_CAP',
    marketCapDivisor: 1_000_000_000
  };
  const evmState = State.createInitialState({ now: 1 });
  evmState.initialized = true;
  assert.throws(
    () => Engine.executeBuy(evmState, { token: evmToken, quote: marketCapOnly, amountNative: 1 }, settings, 1_000),
    /invalidQuote/
  );
});

test('untrusted market-cap mode never overrides a real token price', () => {
  const evmAddress = '0x1111111111111111111111111111111111111111';
  const pumpToken = {
    ...token,
    address: '11111111111111111111111111111111pump',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const cases = [
    {
      token: { chain: 'eth', address: evmAddress, symbol: 'AAA' },
      quote: { ...quote, marketCapUsd: 9_000_000, valuationMode: 'MARKET_CAP', source: 'GMGN_NETWORK', marketCapDivisor: 1_000_000_000 }
    },
    {
      token: pumpToken,
      quote: { ...quote, marketCapUsd: 9_000_000, valuationMode: 'MARKET_CAP', source: 'GMGN_NETWORK', marketCapDivisor: 1_000_000_000 }
    },
    {
      token: pumpToken,
      quote: { ...quote, marketCapUsd: 9_000_000, valuationMode: 'MARKET_CAP', source: 'GMGN_TRENCH_MC', marketCapDivisor: 1_000_000 }
    }
  ];
  for (const item of cases) {
    const next = State.createInitialState({ now: 1 });
    next.initialized = true;
    const result = Engine.executeBuy(next, { token: item.token, quote: item.quote, amountNative: 1 }, settings, 1_000);
    assert.equal(result.trade.observedPriceUsd, 2);
    assert.equal(result.position.valuationMode, 'PRICE');
  }
});

test('trusted Pump market-cap provenance survives detail metadata across every engine boundary', () => {
  const pumpToken = {
    ...token,
    address: '11111111111111111111111111111111pump',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100,
    observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const first = Engine.executeBuy(state(), { token: pumpToken, quote: marketCapQuote, amountNative: 1 }, settings, 1_000);
  const enrichedState = Engine.updatePositionMetadata(first.state, {
    ...pumpToken,
    metadataSource: 'GMGN_DETAIL',
    name: 'Pump Detail'
  });
  const key = Engine.positionKey('sol', pumpToken.address);
  const enriched = enrichedState.positions[key];
  const doubled = { ...marketCapQuote, marketCapUsd: 6_000, observedAt: 2_000 };
  assert.equal(enriched.metadataSource, 'GMGN_DETAIL');
  assert.equal(enriched.marketCapProvenance, 'SOLANA_PUMP_TRENCH_V1');
  assert.ok(Engine.markPosition(enriched, doubled).valueNative > enriched.costBasisNative * 1.9);

  const updated = Engine.updatePositionQuote(enrichedState, pumpToken, doubled);
  assert.equal(updated.positions[key].lastMarketCapUsd, 6_000);
  const rebought = Engine.executeBuy(updated, {
    token: { ...pumpToken, metadataSource: 'GMGN_DETAIL' }, quote: doubled, amountNative: 1
  }, settings, 2_000);
  assert.equal(Number.isFinite(rebought.position.quantity), true);
  assert.ok(rebought.trade.executionPriceUsd > 0);
  const sold = Engine.executeSell(rebought.state, {
    token: { chain: 'sol', address: pumpToken.address }, quote: doubled, percent: 25
  }, settings, 2_000);
  assert.ok(sold.trade.executionPriceUsd > 0);
  assert.equal(sold.trade.priceProvenance, 'MARKET_CAP_DERIVED');
  const closed = Engine.executeCloseAll(sold.state, 'sol', [{
    token: { chain: 'sol', address: pumpToken.address }, quote: doubled
  }], settings, 2_000);
  assert.equal(closed.failures.length, 0);
  assert.equal(closed.trades.length, 1);
});

test('portfolio summary is chain-local', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmQuote = { priceUsd: 2, nativePriceUsd: 2000, observedAt: 1000, nativePriceObservedAt: 1000 };
  let next = state();
  next = Engine.executeBuy(next, { token, quote, amountNative: 10 }, settings, 1000).state;
  next = Engine.executeBuy(next, { token: { chain: 'eth', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 2 }, settings, 1000).state;
  const marked = Engine.updatePositionQuote(next, token, { ...quote, priceUsd: 3, observedAt: 2000 });
  const summary = Engine.portfolioSummary(marked, 'sol');
  assert.equal(summary.positionCount, 1);
  assert.equal(summary.totalTrades, 1);
  assert.ok(summary.equityNative > 100);
});

test('global USD summary excludes native asset appreciation from paper PnL', () => {
  const next = State.createInitialState({ now: 1 });
  next.accounts.sol.cashBalanceNative = 11;
  next.accounts.eth.cashBalanceNative = 8;
  assert.deepEqual(Engine.globalUsdSummary(next, { sol: 150, eth: 2000, bsc: 0, base: 2000, robinhood: 2000, xlayer: 50 }), {
    assetsUsd: 58150, pnlUsd: -3850, complete: false, missingChains: ['bsc']
  });
});

test('chain USD summary values cash and principal at the current native quote but positions at their USD mark', () => {
  const next = State.createInitialState({ now: 1 });
  next.accounts.eth.cashBalanceNative = 9;
  next.positions['eth:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] = {
    chain: 'eth',
    tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    quantity: 1,
    costBasisNative: 1,
    lastPriceUsd: 100,
    lastNativePriceUsd: 100
  };

  assert.deepEqual(Engine.chainUsdSummary(next, 'eth', 200), {
    cashUsd: 1_800,
    positionsUsd: 100,
    assetsUsd: 1_900,
    principalUsd: 2_000,
    pnlUsd: -100
  });
  assert.deepEqual(Engine.globalUsdSummary(next, { eth: 200 }), {
    assetsUsd: 1_900,
    pnlUsd: -100,
    complete: false,
    missingChains: ['sol', 'bsc', 'base', 'robinhood', 'xlayer']
  });
});

test('stale and invalid native quotes are rejected', () => {
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, observedAt: 1 }, amountNative: 1 }, settings, 50_000), /staleQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { priceUsd: 2, nativePriceUsd: 0, observedAt: 1_000 }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
});

test('token and native quote timestamps must be independently valid and fresh', () => {
  const now = 20_000;
  const fresh = { ...quote, observedAt: 5_000, nativePriceObservedAt: 19_999 };
  assert.deepEqual(Engine.validateQuote(fresh, now), { ok: true });

  const missingNative = { ...fresh };
  delete missingNative.nativePriceObservedAt;
  assert.deepEqual(Engine.validateQuote(missingNative, now), { ok: false, reason: 'invalidQuote' });
  for (const nativePriceObservedAt of ['19_999', 19_999.5, 0, -1, NaN, Infinity]) {
    assert.deepEqual(
      Engine.validateQuote({ ...fresh, nativePriceObservedAt }, now),
      { ok: false, reason: 'invalidQuote' }
    );
  }
  assert.deepEqual(
    Engine.validateQuote({ ...fresh, nativePriceObservedAt: now + 5_001 }, now),
    { ok: false, reason: 'invalidQuote' }
  );
  assert.deepEqual(
    Engine.validateQuote({ ...fresh, nativePriceObservedAt: now - 15_001 }, now),
    { ok: false, reason: 'staleQuote' }
  );
});

test('execution rejects invalid identity, non-finite quote data, and unbounded timestamps', () => {
  const badEvm = { chain: 'eth', address: '0x1234' };
  assert.throws(() => Engine.executeBuy(state(), { token: badEvm, quote, amountNative: 1 }, settings, 1_000), /invalidAddress/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, priceUsd: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, nativePriceUsd: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, marketCapUsd: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, observedAt: Infinity }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
  assert.throws(() => Engine.executeBuy(state(), {
    token, quote: { ...quote, observedAt: 1_000 }, staleMs: Infinity, amountNative: 1
  }, settings, 1_000), /invalidQuote/);
});

test('execution rejects non-finite amounts and unsafe fee settings', () => {
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: Infinity }, settings, 1_000), /invalidAmount/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: 1 }, { ...settings, slippageBps: Infinity }, 1_000), /invalidSettings/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: 1 }, { ...settings, platformFeeBps: -1 }, 1_000), /invalidSettings/);
  const badNetworkFee = structuredClone(settings);
  badNetworkFee.chains.sol.networkFeeNative = Infinity;
  assert.throws(() => Engine.executeBuy(state(), { token, quote, amountNative: 1 }, badNetworkFee, 1_000), /invalidSettings/);
});

test('execution stores canonical mixed-case EVM identity', () => {
  const address = '0xA111111111111111111111111111111111111111';
  const result = Engine.executeBuy(
    State.createInitialState({ now: 1 }),
    {
      token: { chain: 'ETH', address },
      quote: { priceUsd: 2, nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000 },
      amountNative: 1
    },
    State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0, chains: { eth: { networkFeeNative: 0 } } }),
    1_000
  );
  assert.equal(result.trade.chain, 'eth');
  assert.equal(result.trade.tokenAddress, address.toLowerCase());
  assert.ok(result.state.positions[`eth:${address.toLowerCase()}`]);
});

test('breakeven sell computes a native percentage needed to recover remaining cost', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  const now = Date.now();
  const higherQuote = { ...quote, priceUsd: 4, observedAt: now, nativePriceObservedAt: now };
  const percent = Engine.breakevenSellPercent(bought.position, higherQuote, settings);
  assert.ok(percent > 45 && percent < 60);
  assert.equal(Engine.breakevenSellPercent(bought.position, { ...higherQuote, priceUsd: 0.5 }, settings), null);
});

test('close all settles every valid position and keeps chain daily pnl consistent', () => {
  const otherToken = { ...token, address: '11111111111111111111111111111113', symbol: 'OTHER' };
  const first = Engine.executeBuy(state(), { token, quote, amountNative: 5 }, settings, 1_000);
  const second = Engine.executeBuy(first.state, { token: otherToken, quote, amountNative: 5 }, settings, 1_100);
  const closeQuote = { ...quote, priceUsd: 3, marketCapUsd: 3_000_000, observedAt: 2_000 };
  const result = Engine.executeCloseAll(second.state, 'sol', [
    { token, quote: closeQuote }, { token: otherToken, quote: closeQuote }
  ], settings, 2_000);
  assert.equal(Object.keys(result.state.positions).length, 0);
  assert.equal(result.trades.length, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(Object.keys(result.state.dailyRealizedByChain.sol).length, 1);
  assert.ok(result.state.accounts.sol.cashBalanceNative > second.state.accounts.sol.cashBalanceNative);
});

test('adding a market-cap trench quote to a price position keeps the original valuation mode', () => {
  const pumpToken = {
    ...token,
    address: '11111111111111111111111111111111pump',
    metadataVerified: true,
    metadataSource: 'GMGN_TRENCH'
  };
  const first = Engine.executeBuy(state(), { token: pumpToken, quote, amountNative: 1 }, settings, 1_000);
  const listQuote = {
    priceUsd: 0, marketCapUsd: 4_000_000, nativePriceUsd: 100,
    observedAt: 2_000, nativePriceObservedAt: 2_000,
    source: 'GMGN_TRENCH_MC', valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const second = Engine.executeBuy(first.state, { token: pumpToken, quote: listQuote, amountNative: 1 }, settings, 2_000);
  assert.equal(second.position.valuationMode, 'PRICE');
  assert.ok(second.position.averageEntryPriceUsd > 2 && second.position.averageEntryPriceUsd < 4.1);
});

test('detail metadata replaces a trench placeholder without changing chain balances', () => {
  const placeholder = { ...token, symbol: 'TOKEN', name: 'Token' };
  const bought = Engine.executeBuy(state(), { token: placeholder, quote, amountNative: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const enriched = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'Cogito', name: 'Cogito Token', logoUrl: 'https://example.com/cogito.png',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  assert.equal(enriched.positions[key].symbol, 'Cogito');
  assert.equal(enriched.positions[key].name, 'Cogito Token');
  assert.equal(enriched.positions[key].quantity, bought.state.positions[key].quantity);
  assert.equal(enriched.accounts.sol.cashBalanceNative, bought.state.accounts.sol.cashBalanceNative);
});

test('buying on a detail page cannot change another position logo', () => {
  const trenchToken = { ...token, address: '11111111111111111111111111111114', symbol: 'TRENCH', logoUrl: 'https://example.com/trench.png' };
  const detailToken = { ...token, address: '11111111111111111111111111111115', symbol: 'DETAIL', logoUrl: 'https://example.com/detail.png' };
  const trenchBuy = Engine.executeBuy(state(), { token: trenchToken, quote, amountNative: 1 }, settings, 1_000);
  const detailBuy = Engine.executeBuy(trenchBuy.state, { token: detailToken, quote, amountNative: 1 }, settings, 1_100);
  const detailRebuy = Engine.executeBuy(detailBuy.state, {
    token: { ...detailToken, logoUrl: 'https://example.com/detail-new.png' }, quote, amountNative: 1
  }, settings, 1_200);
  assert.equal(detailRebuy.state.positions[Engine.positionKey('sol', trenchToken.address)].logoUrl, trenchToken.logoUrl);
  assert.equal(detailRebuy.state.positions[Engine.positionKey('sol', detailToken.address)].logoUrl, detailToken.logoUrl);

  const verifiedLogoRefresh = Engine.updatePositionMetadata(detailRebuy.state, {
    ...detailToken, logoUrl: 'https://example.com/detail-new.png', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  const rebuyAfterRefresh = Engine.executeBuy(verifiedLogoRefresh, {
    token: { ...detailToken, logoUrl: '' }, quote, amountNative: 1
  }, settings, 1_300);
  assert.equal(rebuyAfterRefresh.state.positions[Engine.positionKey('sol', trenchToken.address)].logoUrl, trenchToken.logoUrl);
  assert.equal(rebuyAfterRefresh.state.positions[Engine.positionKey('sol', detailToken.address)].logoUrl, 'https://example.com/detail-new.png');
});

test('trading one of several positions cannot replace any existing token identity', () => {
  const tokens = [
    { ...token, address: '11111111111111111111111111111117', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: '11111111111111111111111111111118', symbol: 'BBB', name: 'Beta', logoUrl: 'https://example.com/b.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: '11111111111111111111111111111119', symbol: 'CCC', name: 'Gamma', logoUrl: 'https://example.com/c.png', metadataSource: 'GMGN_TRENCH' }
  ];
  let next = state();
  tokens.forEach((item, index) => {
    next = Engine.executeBuy(next, { token: item, quote: { ...quote, observedAt: 1_000 + index }, amountNative: 1 }, settings, 1_000 + index).state;
  });
  const identitiesBefore = Object.fromEntries(Object.entries(next.positions).map(([key, position]) => [key, {
    symbol: position.symbol, name: position.name, logoUrl: position.logoUrl, metadataSource: position.metadataSource
  }]));
  const staleHeaderForB = {
    ...tokens[1], symbol: tokens[0].symbol, name: tokens[0].name, logoUrl: tokens[0].logoUrl,
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  const afterRebuy = Engine.executeBuy(next, {
    token: staleHeaderForB, quote: { ...quote, observedAt: 2_000 }, amountNative: 1
  }, settings, 2_000).state;
  const identitiesAfter = Object.fromEntries(Object.entries(afterRebuy.positions).map(([key, position]) => [key, {
    symbol: position.symbol, name: position.name, logoUrl: position.logoUrl, metadataSource: position.metadataSource
  }]));
  assert.deepEqual(identitiesAfter, identitiesBefore);
});

test('only verified address-bound metadata can repair a position and detail outranks trench', () => {
  const trenchToken = { ...token, symbol: 'TOKEN', name: 'Token', logoUrl: '', metadataVerified: true, metadataSource: 'GMGN_TRENCH' };
  const bought = Engine.executeBuy(state(), { token: trenchToken, quote, amountNative: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const ignoredNetwork = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'WRONG', name: 'Wrong', logoUrl: 'https://example.com/wrong.png', metadataVerified: false, metadataSource: 'GMGN_NETWORK'
  });
  assert.equal(ignoredNetwork, bought.state);
  const detail = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'RIGHT', name: 'Right Token', logoUrl: 'https://example.com/right.png', metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  assert.equal(detail.positions[key].symbol, 'RIGHT');
  assert.equal(detail.positions[key].logoUrl, 'https://example.com/right.png');
  const staleTrench = Engine.updatePositionMetadata(detail, {
    ...token, symbol: 'STALE', name: 'Stale', logoUrl: 'https://example.com/stale.png', metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  });
  assert.equal(staleTrench, detail);
});

test('an unverified new order cannot seed a borrowed name or logo', () => {
  const borrowed = {
    ...token, address: '11111111111111111111111111111116', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png',
    metadataVerified: false, metadataSource: 'GMGN_NETWORK'
  };
  const bought = Engine.executeBuy(state(), { token: borrowed, quote, amountNative: 1 }, settings, 1_000);
  assert.equal(bought.position.symbol, 'TOKEN');
  assert.equal(bought.position.name, 'TOKEN');
  assert.equal(bought.position.logoUrl, '');
});

test('a repeat buy does not promote the source rank of legacy identity data', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const legacy = structuredClone(bought.state);
  delete legacy.positions[key].metadataSource;
  legacy.positions[key].symbol = '3';
  legacy.positions[key].name = '3';
  const repeated = Engine.executeBuy(legacy, { token, quote: { ...quote, observedAt: 2_000 }, amountNative: 1 }, settings, 2_000);
  assert.equal(repeated.position.symbol, '3');
  assert.equal(repeated.position.metadataSource, '');
});
