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
    liquidityUsd: 0, symbol: '', name: '', logoUrl: '', observedAt: 123, source: 'GMGN_NETWORK'
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
    symbol: 'SOL', name: 'Solana', logoUrl: 'x'.repeat(1000), observedAt: 456, source: 'GMGN_NETWORK'
  }]);
});
