const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/shared/constants.js');
const Engine = require('../src/core/engine.js');

function state(balance = 100) {
  const value = global.Tango.createInitialState(balance);
  value.initialized = true;
  return value;
}

const settings = { slippageBps: 100, platformFeeBps: 100, networkFeeSol: 0.001 };
const token = {
  chain: 'sol', address: 'TokenAddress111', symbol: 'TANGO', name: 'Tango',
  metadataVerified: true, metadataSource: 'GMGN_DETAIL'
};
const quote = { priceUsd: 2, marketCapUsd: 2_000_000, liquidityUsd: 500_000, solPriceUsd: 100, observedAt: 1_000 };

test('buy reduces cash and creates a weighted position', () => {
  const first = Engine.executeBuy(state(), { token, quote, amountSol: 10 }, settings, 1_000);
  assert.equal(first.state.account.cashBalanceSol, 90);
  assert.equal(first.position.costBasisSol, 10);
  assert.ok(first.position.quantity > 0);
  assert.equal(first.trade.side, 'BUY');

  const secondQuote = { ...quote, priceUsd: 4, marketCapUsd: 4_000_000, observedAt: 2_000 };
  const second = Engine.executeBuy(first.state, { token, quote: secondQuote, amountSol: 10 }, settings, 2_000);
  assert.equal(second.state.account.cashBalanceSol, 80);
  assert.equal(second.position.costBasisSol, 20);
  assert.ok(second.position.averageEntryPriceUsd > 2 && second.position.averageEntryPriceUsd < 4.1);
});

test('partial sell preserves the remaining cost basis and realizes pnl', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountSol: 10 }, settings, 1_000);
  const sellQuote = { ...quote, priceUsd: 4, marketCapUsd: 4_000_000, observedAt: 2_000 };
  const sold = Engine.executeSell(bought.state, { token, quote: sellQuote, percent: 50 }, settings, 2_000);
  const key = Engine.positionKey('sol', token.address);
  assert.ok(sold.state.positions[key]);
  assert.ok(Math.abs(sold.state.positions[key].costBasisSol - 5) < 1e-9);
  assert.ok(sold.trade.realizedPnlSol > 0);
  assert.equal(sold.trade.side, 'SELL');
});

test('full sell removes position and updates daily realized pnl', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountSol: 10 }, settings, 1_000);
  const sellQuote = { ...quote, priceUsd: 3, observedAt: 2_000 };
  const sold = Engine.executeSell(bought.state, { token, quote: sellQuote, percent: 100 }, settings, 2_000);
  assert.equal(Object.keys(sold.state.positions).length, 0);
  assert.ok(Object.values(sold.state.dailyRealized).some((value) => value !== 0));
});

test('close all settles every valid position and keeps calendar pnl consistent', () => {
  const otherToken = { ...token, address: 'TokenAddress222', symbol: 'OTHER' };
  const first = Engine.executeBuy(state(), { token, quote, amountSol: 5 }, settings, 1_000);
  const second = Engine.executeBuy(first.state, { token: otherToken, quote, amountSol: 5 }, settings, 1_100);
  const closeQuote = { ...quote, priceUsd: 3, marketCapUsd: 3_000_000, observedAt: 2_000 };
  const result = Engine.executeCloseAll(second.state, [
    { token, quote: closeQuote },
    { token: otherToken, quote: closeQuote }
  ], settings, 2_000);
  assert.equal(Object.keys(result.state.positions).length, 0);
  assert.equal(result.trades.length, 2);
  assert.equal(result.failures.length, 0);
  assert.equal(Object.values(result.state.dailyRealized).length, 1);
  assert.ok(result.state.account.cashBalanceSol > second.state.account.cashBalanceSol);
});

test('stale and invalid quotes are rejected', () => {
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { ...quote, observedAt: 1 }, amountSol: 1 }, settings, 50_000), /staleQuote/);
  assert.throws(() => Engine.executeBuy(state(), { token, quote: { priceUsd: 0, observedAt: 1_000 }, amountSol: 1 }, settings, 1_000), /invalidQuote/);
});

test('market-cap-only trench quotes can buy and track pnl without a token price', () => {
  const marketCapQuote = {
    priceUsd: 0, marketCapUsd: 3_000, solPriceUsd: 100, observedAt: 1_000,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const bought = Engine.executeBuy(state(), { token, quote: marketCapQuote, amountSol: 1 }, settings, 1_000);
  assert.equal(bought.position.valuationMode, 'MARKET_CAP');
  assert.ok(bought.position.quantity > 0);

  const doubled = { ...marketCapQuote, marketCapUsd: 6_000, observedAt: 2_000 };
  const mark = Engine.markPosition(bought.position, doubled);
  assert.ok(mark.valueSol > bought.position.costBasisSol * 1.9);
  const sold = Engine.executeSell(bought.state, { token, quote: doubled, percent: 100 }, settings, 2_000);
  assert.ok(sold.trade.realizedPnlSol > 0);
});

test('adding a market-cap trench quote to a price position keeps the original valuation mode', () => {
  const first = Engine.executeBuy(state(), { token, quote, amountSol: 1 }, settings, 1_000);
  const listQuote = {
    priceUsd: 0, marketCapUsd: 4_000_000, solPriceUsd: 100, observedAt: 2_000,
    valuationMode: 'MARKET_CAP', marketCapDivisor: 1_000_000_000
  };
  const second = Engine.executeBuy(first.state, { token, quote: listQuote, amountSol: 1 }, settings, 2_000);
  assert.equal(second.position.valuationMode, 'PRICE');
  assert.ok(second.position.averageEntryPriceUsd > 2 && second.position.averageEntryPriceUsd < 4.1);
});

test('portfolio summary combines cash, marked positions and trade stats', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountSol: 10 }, settings, 1_000);
  const marked = Engine.updatePositionQuote(bought.state, token, { ...quote, priceUsd: 3, observedAt: 2_000 });
  const summary = Engine.portfolioSummary(marked);
  assert.equal(summary.positionCount, 1);
  assert.ok(summary.equitySol > 100);
  assert.ok(summary.unrealizedPnlSol > 0);
});

test('breakeven sell computes the percentage needed to recover remaining cost', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountSol: 10 }, settings, 1_000);
  const higherQuote = { ...quote, priceUsd: 4, observedAt: Date.now() };
  const percent = Engine.breakevenSellPercent(bought.position, higherQuote, settings);
  assert.ok(percent > 45 && percent < 60);
  assert.equal(Engine.breakevenSellPercent(bought.position, { ...quote, priceUsd: 0.5, observedAt: Date.now() }, settings), null);
});

test('detail metadata replaces a trench placeholder without changing balances', () => {
  const placeholder = { ...token, symbol: 'TOKEN', name: 'Token' };
  const bought = Engine.executeBuy(state(), { token: placeholder, quote, amountSol: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const enriched = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'Cogito', name: '我认为', logoUrl: 'https://example.com/cogito.png',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  assert.equal(enriched.positions[key].symbol, 'Cogito');
  assert.equal(enriched.positions[key].name, '我认为');
  assert.equal(enriched.positions[key].quantity, bought.state.positions[key].quantity);
  assert.equal(enriched.account.cashBalanceSol, bought.state.account.cashBalanceSol);
});

test('buying on a detail page cannot change another position logo', () => {
  const trenchToken = { ...token, address: 'TrenchToken111', symbol: 'TRENCH', logoUrl: 'https://example.com/trench.png' };
  const detailToken = { ...token, address: 'DetailToken222', symbol: 'DETAIL', logoUrl: 'https://example.com/detail.png' };
  const trenchBuy = Engine.executeBuy(state(), { token: trenchToken, quote, amountSol: 1 }, settings, 1_000);
  const detailBuy = Engine.executeBuy(trenchBuy.state, { token: detailToken, quote, amountSol: 1 }, settings, 1_100);
  const detailRebuy = Engine.executeBuy(detailBuy.state, {
    token: { ...detailToken, logoUrl: 'https://example.com/detail-new.png' }, quote, amountSol: 1
  }, settings, 1_200);
  assert.equal(detailRebuy.state.positions[Engine.positionKey('sol', trenchToken.address)].logoUrl, trenchToken.logoUrl);
  assert.equal(detailRebuy.state.positions[Engine.positionKey('sol', detailToken.address)].logoUrl, detailToken.logoUrl);

  const verifiedLogoRefresh = Engine.updatePositionMetadata(detailRebuy.state, {
    ...detailToken, logoUrl: 'https://example.com/detail-new.png',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  const detailRebuyBeforeLogoLoads = Engine.executeBuy(verifiedLogoRefresh, {
    token: { ...detailToken, logoUrl: '' }, quote, amountSol: 1
  }, settings, 1_300);
  assert.equal(detailRebuyBeforeLogoLoads.state.positions[Engine.positionKey('sol', trenchToken.address)].logoUrl, trenchToken.logoUrl);
  assert.equal(detailRebuyBeforeLogoLoads.state.positions[Engine.positionKey('sol', detailToken.address)].logoUrl, 'https://example.com/detail-new.png');
});

test('trading one of several positions cannot replace any existing token identity', () => {
  const tokens = [
    { ...token, address: 'AddressA111', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: 'AddressB222', symbol: 'BBB', name: 'Beta', logoUrl: 'https://example.com/b.png', metadataSource: 'GMGN_TRENCH' },
    { ...token, address: 'AddressC333', symbol: 'CCC', name: 'Gamma', logoUrl: 'https://example.com/c.png', metadataSource: 'GMGN_TRENCH' }
  ];
  let next = state();
  tokens.forEach((item, index) => {
    next = Engine.executeBuy(next, { token: item, quote: { ...quote, observedAt: 1_000 + index }, amountSol: 1 }, settings, 1_000 + index).state;
  });
  const identitiesBefore = Object.fromEntries(Object.entries(next.positions).map(([key, position]) => [key, {
    symbol: position.symbol, name: position.name, logoUrl: position.logoUrl, metadataSource: position.metadataSource
  }]));

  const staleHeaderForB = {
    ...tokens[1], symbol: tokens[0].symbol, name: tokens[0].name, logoUrl: tokens[0].logoUrl,
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  };
  const afterRebuy = Engine.executeBuy(next, {
    token: staleHeaderForB, quote: { ...quote, observedAt: 2_000 }, amountSol: 1
  }, settings, 2_000).state;
  const identitiesAfter = Object.fromEntries(Object.entries(afterRebuy.positions).map(([key, position]) => [key, {
    symbol: position.symbol, name: position.name, logoUrl: position.logoUrl, metadataSource: position.metadataSource
  }]));
  assert.deepEqual(identitiesAfter, identitiesBefore);
});

test('only verified address-bound metadata can repair a position and detail outranks trench', () => {
  const trenchToken = {
    ...token, symbol: 'TOKEN', name: 'Token', logoUrl: '',
    metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  };
  const bought = Engine.executeBuy(state(), { token: trenchToken, quote, amountSol: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const ignoredNetwork = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'WRONG', name: 'Wrong', logoUrl: 'https://example.com/wrong.png',
    metadataVerified: false, metadataSource: 'GMGN_NETWORK'
  });
  assert.equal(ignoredNetwork, bought.state);

  const detail = Engine.updatePositionMetadata(bought.state, {
    ...token, symbol: 'RIGHT', name: 'Right Token', logoUrl: 'https://example.com/right.png',
    metadataVerified: true, metadataSource: 'GMGN_DETAIL'
  });
  assert.equal(detail.positions[key].symbol, 'RIGHT');
  assert.equal(detail.positions[key].logoUrl, 'https://example.com/right.png');

  const staleTrench = Engine.updatePositionMetadata(detail, {
    ...token, symbol: 'STALE', name: 'Stale', logoUrl: 'https://example.com/stale.png',
    metadataVerified: true, metadataSource: 'GMGN_TRENCH'
  });
  assert.equal(staleTrench, detail);
});

test('an unverified new order cannot seed a borrowed name or logo', () => {
  const borrowed = {
    ...token, address: 'NewAddress444', symbol: 'AAA', name: 'Alpha', logoUrl: 'https://example.com/a.png',
    metadataVerified: false, metadataSource: 'GMGN_NETWORK'
  };
  const bought = Engine.executeBuy(state(), { token: borrowed, quote, amountSol: 1 }, settings, 1_000);
  assert.equal(bought.position.symbol, 'TOKEN');
  assert.equal(bought.position.name, 'TOKEN');
  assert.equal(bought.position.logoUrl, '');
});

test('a repeat buy does not promote the source rank of legacy identity data', () => {
  const bought = Engine.executeBuy(state(), { token, quote, amountSol: 1 }, settings, 1_000);
  const key = Engine.positionKey(token.chain, token.address);
  const legacy = structuredClone(bought.state);
  delete legacy.positions[key].metadataSource;
  legacy.positions[key].symbol = '3';
  legacy.positions[key].name = '3';
  const repeated = Engine.executeBuy(legacy, { token, quote: { ...quote, observedAt: 2_000 }, amountSol: 1 }, settings, 2_000);
  assert.equal(repeated.position.symbol, '3');
  assert.equal(repeated.position.metadataSource, '');
});
