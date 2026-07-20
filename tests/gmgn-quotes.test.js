const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
const Quotes = require('../src/adapters/gmgn-quotes.js');

test('EVM quotes bind to one explicit active chain', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const quotes = Quotes.extract({ data: [{ address, price_usd: '2', market_cap: '2000' }] }, 'base', 123);
  assert.deepEqual(quotes, [{
    chain: 'base', address: address.toLowerCase(), priceUsd: 2, marketCapUsd: 2000,
    liquidityUsd: 0, symbol: '', name: '', logoUrl: '', priceObservedAt: 123,
    marketCapObservedAt: 123, observedAt: 123, source: 'GMGN_NETWORK'
  }]);
});

test('invalid addresses and unknown chains are discarded', () => {
  assert.deepEqual(Quotes.extract({ address: 'bad', price: 1 }, 'eth', 123), []);
  assert.deepEqual(Quotes.extract({
    address: '0x1111111111111111111111111111111111111111', price: 1
  }, 'unknown', 123), []);
});

test('duplicate quote fragments merge compact numbers and bounded metadata', () => {
  const address = 'So11111111111111111111111111111111111111112';
  const quotes = Quotes.extract({ data: [
    { mint: address, price: '$0.25', symbol: '$SOL', name: ' Solana ' },
    { token_address: address, market_cap: '2.5M', liquidity: { usd: '125K' }, logo_url: 'x'.repeat(1100) }
  ] }, 'sol', 456);
  assert.deepEqual(quotes, [{
    chain: 'sol', address, priceUsd: 0.25, marketCapUsd: 2_500_000, liquidityUsd: 125_000,
    symbol: 'SOL', name: 'Solana', logoUrl: 'x'.repeat(1000), priceObservedAt: 456,
    marketCapObservedAt: 456, observedAt: 456, source: 'GMGN_NETWORK'
  }]);
});

test('successive exact-identity observations merge without erasing price or metadata', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const full = {
    chain: 'base', address, priceUsd: 2, marketCapUsd: 2_000, liquidityUsd: 500,
    symbol: 'FULL', name: 'Full Token', logoUrl: 'https://example.com/full.png',
    observedAt: 100, source: 'GMGN_NETWORK'
  };
  const priceOnly = {
    chain: 'base', address, priceUsd: 3, marketCapUsd: 0, liquidityUsd: 0,
    symbol: '', name: '', logoUrl: '', observedAt: 200, source: 'GMGN_NETWORK'
  };

  assert.deepEqual(Quotes.mergeObservation(full, priceOnly), {
    ...full, priceUsd: 3, observedAt: 200, priceObservedAt: 200, marketCapObservedAt: 100
  });
  assert.deepEqual(Quotes.mergeObservation(priceOnly, full), {
    ...full, observedAt: 100, priceObservedAt: 100, marketCapObservedAt: 100
  });
});

test('a newer market-cap-only fragment does not make an older retained price look fresh', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const price = {
    chain: 'eth', address, priceUsd: 2, marketCapUsd: 0,
    observedAt: 100, source: 'GMGN_NETWORK'
  };
  const marketCap = {
    chain: 'eth', address, priceUsd: 0, marketCapUsd: 5_000,
    observedAt: 200, source: 'GMGN_NETWORK'
  };
  const merged = Quotes.mergeObservation(price, marketCap);
  assert.equal(merged.priceUsd, 2);
  assert.equal(merged.marketCapUsd, 5_000);
  assert.equal(merged.priceObservedAt, 100);
  assert.equal(merged.marketCapObservedAt, 200);
  assert.equal(merged.observedAt, 100);
});

test('observation merging refuses another chain or token identity', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const previous = { chain: 'eth', address, priceUsd: 2, observedAt: 100, source: 'GMGN_NETWORK' };
  assert.equal(Quotes.mergeObservation(previous, { ...previous, chain: 'base' }), null);
  assert.equal(Quotes.mergeObservation(previous, {
    ...previous, address: '0x2222222222222222222222222222222222222222'
  }), null);
});
