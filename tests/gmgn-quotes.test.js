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
    liquidityUsd: 0, totalSupply: 0, totalSupplySource: '', symbol: '', name: '', logoUrl: '',
    launchpad: '', launchMode: '', priceObservedAt: 123, marketCapObservedAt: 123,
    totalSupplyObservedAt: 0, metadataObservedAt: 0, observedAt: 123, source: 'GMGN_NETWORK'
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
    totalSupply: 0, totalSupplySource: '', symbol: 'SOL', name: 'Solana', logoUrl: 'x'.repeat(1000),
    launchpad: '', launchMode: '', priceObservedAt: 456, marketCapObservedAt: 456,
    totalSupplyObservedAt: 0, metadataObservedAt: 456, observedAt: 456, source: 'GMGN_NETWORK'
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
    ...full, priceUsd: 3, totalSupply: 0, totalSupplySource: '', launchpad: '', launchMode: '',
    observedAt: 200, priceObservedAt: 200, marketCapObservedAt: 100,
    totalSupplyObservedAt: 0, metadataObservedAt: 100
  });
  assert.deepEqual(Quotes.mergeObservation(priceOnly, full), {
    ...full, totalSupply: 0, totalSupplySource: '', launchpad: '', launchMode: '',
    priceUsd: 3, observedAt: 200, priceObservedAt: 200, marketCapObservedAt: 100,
    totalSupplyObservedAt: 0, metadataObservedAt: 100
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

test('GMGN full-info fields include supply, launchpad, and launch mode', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({ data: [{
    token_address: address,
    price_usd: '0.000002',
    market_cap: '2000',
    total_supply: '1000000000',
    launchpad: 'Clanker',
    launch_mode: 'standard',
    symbol: 'RIGHT',
    name: 'Right Token',
    logo_url: 'right.png'
  }] }, 'base', 500);
  assert.equal(quote.totalSupply, 1_000_000_000);
  assert.equal(quote.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.equal(quote.launchpad, 'Clanker');
  assert.equal(quote.launchMode, 'standard');
  assert.equal(quote.totalSupplyObservedAt, 500);
});

test('older response fields cannot overwrite newer price, supply, or metadata', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const newer = {
    chain: 'eth', address, priceUsd: 3, totalSupply: 2_000_000_000,
    symbol: 'NEW', observedAt: 300, priceObservedAt: 300,
    totalSupplyObservedAt: 300, metadataObservedAt: 300, source: 'GMGN_NETWORK'
  };
  const older = {
    chain: 'eth', address, priceUsd: 2, totalSupply: 1_000_000_000,
    symbol: 'OLD', observedAt: 100, source: 'GMGN_NETWORK'
  };
  const merged = Quotes.mergeObservation(newer, older);
  assert.equal(merged.priceUsd, 3);
  assert.equal(merged.totalSupply, 2_000_000_000);
  assert.equal(merged.symbol, 'NEW');
});

test('major coin price payloads produce only registered native symbols', () => {
  assert.deepEqual(Quotes.extractNativePrices({ data: [
    { symbol: 'SOL', price: '150' },
    { symbol: 'ETH', price_usd: '3500' },
    { symbol: 'RANDOM', price: '9' }
  ] }, 700), [
    { symbol: 'SOL', priceUsd: 150, observedAt: 700, source: 'GMGN_MAJOR_COIN' },
    { symbol: 'ETH', priceUsd: 3500, observedAt: 700, source: 'GMGN_MAJOR_COIN' }
  ]);
});
