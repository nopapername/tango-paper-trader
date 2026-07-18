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
  chain: 'sol', address: 'TokenAddress111', symbol: 'TANGO', name: 'Tango',
  metadataVerified: true, metadataSource: 'GMGN_DETAIL'
};
const quote = { priceUsd: 2, marketCapUsd: 2_000_000, liquidityUsd: 500_000, nativePriceUsd: 100, observedAt: 1_000 };

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
  const evmQuote = { priceUsd: 2, marketCapUsd: 2_000_000, nativePriceUsd: 2000, observedAt: 1000 };
  next = Engine.executeBuy(next, { token: { chain: 'eth', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 1 }, chainSettings, 1000).state;
  next = Engine.executeBuy(next, { token: { chain: 'base', address, symbol: 'AAA' }, quote: evmQuote, amountNative: 2 }, chainSettings, 1000).state;
  assert.equal(next.accounts.eth.cashBalanceNative, 9);
  assert.equal(next.accounts.base.cashBalanceNative, 8);
  assert.notEqual(next.positions[`eth:${address}`].costBasisNative, next.positions[`base:${address}`].costBasisNative);
});

test('close all only closes orders for the requested chain', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmQuote = { priceUsd: 2, marketCapUsd: 2_000_000, nativePriceUsd: 2000, observedAt: 1000 };
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

test('market-cap-only trench quotes can buy and track native pnl without a token price', () => {
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 3_000, nativePriceUsd: 100, observedAt: 1_000,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const bought = Engine.executeBuy(state(), { token, quote: marketCapQuote, amountNative: 1 }, settings, 1_000);
  assert.equal(bought.position.valuationMode, 'MARKET_CAP');
  const doubled = { ...marketCapQuote, marketCapUsd: 6_000, observedAt: 2_000 };
  const mark = Engine.markPosition(bought.position, doubled);
  assert.ok(mark.valueNative > bought.position.costBasisNative * 1.9);
  assert.ok(Engine.executeSell(bought.state, { token, quote: doubled, percent: 100 }, settings, 2_000).trade.realizedPnlNative > 0);
});

test('portfolio summary is chain-local', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const evmQuote = { priceUsd: 2, nativePriceUsd: 2000, observedAt: 1000 };
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

test('stale and invalid native quotes are rejected', () => {
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, observedAt: 1 }, amountNative: 1 }, settings, 50_000), /staleQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { priceUsd: 2, nativePriceUsd: 0, observedAt: 1_000 }, amountNative: 1 }, settings, 1_000), /invalidQuote/);
});

test('breakeven sell computes a native percentage needed to recover remaining cost', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountNative: 10 }, settings, 1_000);
  const higherQuote = { ...quote, priceUsd: 4, observedAt: Date.now() };
  const percent = Engine.breakevenSellPercent(bought.position, higherQuote, settings);
  assert.ok(percent > 45 && percent < 60);
  assert.equal(Engine.breakevenSellPercent(bought.position, { ...quote, priceUsd: 0.5, observedAt: Date.now() }, settings), null);
});

test('close all settles every valid position and keeps chain daily pnl consistent', () => {
  const otherToken = { ...token, address: 'TokenAddress222', symbol: 'OTHER' };
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
  const first = Engine.executeBuy(state(), { token, quote, amountNative: 1 }, settings, 1_000);
  const listQuote = {
    priceUsd: 0, marketCapUsd: 4_000_000, nativePriceUsd: 100, observedAt: 2_000,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const second = Engine.executeBuy(first.state, { token, quote: listQuote, amountNative: 1 }, settings, 2_000);
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
  const trenchToken = { ...token, address: 'TrenchToken111', symbol: 'TRENCH', logoUrl: 'https://example.com/trench.png' };
  const detailToken = { ...token, address: 'DetailToken222', symbol: 'DETAIL', logoUrl: 'https://example.com/detail.png' };
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
    { ...token, address: 'AddressA111', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: 'AddressB222', symbol: 'BBB', name: 'Beta', logoUrl: 'https://example.com/b.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: 'AddressC333', symbol: 'CCC', name: 'Gamma', logoUrl: 'https://example.com/c.png', metadataSource: 'GMGN_TRENCH' }
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
    ...token, address: 'NewAddress444', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png',
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
