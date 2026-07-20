const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
const Supply = require('../src/core/supply.js');

test('exact GMGN supply wins over ratio and launchpad rules', () => {
  assert.deepEqual(Supply.resolve({
    chain: 'sol', launchpad: 'pump.fun', launchMode: 'mayhem',
    totalSupply: 1_234_567_890, priceUsd: 2, marketCapUsd: 4_000_000_000
  }), { totalSupply: 1_234_567_890, source: 'GMGN_EXACT', confidence: 'exact' });
});

test('same-observation market cap and price infer supply before registry fallback', () => {
  assert.deepEqual(Supply.resolve({
    chain: 'base', launchpad: 'clanker', priceUsd: 0.000002, marketCapUsd: 2_000
  }), { totalSupply: 1_000_000_000, source: 'GMGN_RATIO', confidence: 'inferred' });
});

test('launchpad and mode rules distinguish 1B, 2B, and 100B supplies', () => {
  assert.equal(Supply.ruleSupply('sol', 'Pump.fun', 'standard'), 1_000_000_000);
  assert.equal(Supply.ruleSupply('sol', 'Pump.fun', 'Mayhem'), 2_000_000_000);
  assert.equal(Supply.ruleSupply('base', 'Bankr', ''), 100_000_000_000);
  assert.equal(Supply.ruleSupply('robinhood', 'Clanker', ''), 100_000_000_000);
  assert.equal(Supply.ruleSupply('xlayer', 'DYOR', ''), 1_000_000_000);
});

test('launchpad fallback rejects known platforms on the wrong chain', () => {
  assert.equal(Supply.ruleSupply('eth', 'Zora', ''), 0);
  assert.equal(Supply.ruleSupply('base', 'Four.meme', ''), 0);
  assert.equal(Supply.ruleSupply('bsc', 'DYOR', ''), 0);
  assert.equal(Supply.ruleSupply('sol', 'Bankr', ''), 0);
  assert.equal(Supply.resolve({ chain: 'eth', launchpad: 'Zora' }), null);
});

test('unknown launchpads do not synthesize a factual supply', () => {
  assert.equal(Supply.resolve({ chain: 'eth', launchpad: 'unknown.fun' }), null);
  assert.equal(Supply.resolve({ chain: 'eth', marketCapUsd: 1000, priceUsd: 0 }), null);
});
