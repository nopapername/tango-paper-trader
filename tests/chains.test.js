const test = require('node:test');
const assert = require('node:assert/strict');
const Chains = require('../src/core/chains.js');

test('registry exposes the six approved chains once', () => {
  assert.deepEqual(Chains.all().map((chain) => chain.id), ['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']);
  assert.deepEqual(Chains.all().map((chain) => chain.nativeSymbol), ['SOL', 'ETH', 'BNB', 'ETH', 'ETH', 'OKB']);
  assert.equal(new Set(Chains.all().map((chain) => chain.gmgnSlug)).size, 6);
});

test('route resolution accepts registered detail and trench URLs only', () => {
  assert.equal(Chains.fromUrl('https://gmgn.ai/eth/token/0x1111111111111111111111111111111111111111').id, 'eth');
  assert.equal(Chains.fromUrl('https://gmgn.ai/?chain=xlayer').id, 'xlayer');
  assert.equal(Chains.fromUrl('https://gmgn.ai/?chain=unknown'), null);
});

test('address validation is family-specific and normalization is deterministic', () => {
  const evm = '0xA111111111111111111111111111111111111111';
  assert.equal(Chains.validateAddress('eth', evm), true);
  assert.equal(Chains.normalizeAddress('base', evm), evm.toLowerCase());
  assert.equal(Chains.validateAddress('sol', evm), false);
  assert.equal(Chains.validateAddress('sol', 'So11111111111111111111111111111111111111112'), true);
  assert.equal(
    Chains.validateAddress('sol', '11111111111111111111111111111111pump'),
    false,
    'Base58 text must decode to exactly 32 bytes'
  );
});

test('token URLs validate the address before construction', () => {
  assert.equal(
    Chains.tokenUrl('bsc', '0x1111111111111111111111111111111111111111'),
    'https://gmgn.ai/bsc/token/0x1111111111111111111111111111111111111111'
  );
  assert.throws(() => Chains.tokenUrl('bsc', 'not-an-address'), /invalidAddress/);
});
