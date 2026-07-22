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
    chain: 'base', address: '0x1111111111111111111111111111111111111111',
    launchpad: 'clanker', priceUsd: 0.000002, marketCapUsd: 2_000,
    observedAt: 123, source: 'GMGN_NETWORK'
  }), { totalSupply: 1_000_000_000, source: 'GMGN_RATIO', confidence: 'inferred' });
});

test('incoherent valuation fields fall through to the verified launchpad rule', () => {
  assert.deepEqual(Supply.resolve({
    chain: 'base', address: '0x1111111111111111111111111111111111111111',
    launchpad: 'clanker', priceUsd: 2, marketCapUsd: 200_000,
    priceObservedAt: 200, marketCapObservedAt: 100,
    priceSource: 'GMGN_NETWORK', marketCapSource: 'GMGN_NETWORK'
  }), { totalSupply: 100_000_000_000, source: 'LAUNCHPAD_RULE', confidence: 'fallback' });
});

test('a declared GMGN ratio still requires one identity-bound factual observation', () => {
  const coherent = {
    chain: 'base', address: '0x1111111111111111111111111111111111111111',
    launchpad: 'clanker', priceUsd: 2, marketCapUsd: 200_000,
    totalSupply: 100_000, supplySource: 'GMGN_RATIO',
    priceObservedAt: 200, marketCapObservedAt: 200,
    priceSource: 'GMGN_NETWORK', marketCapSource: 'GMGN_NETWORK',
    priceProvenance: 'OBSERVED_PRICE'
  };
  assert.deepEqual(Supply.resolve(coherent), {
    totalSupply: 100_000, source: 'GMGN_RATIO', confidence: 'inferred'
  });

  for (const mismatch of [
    { priceObservedAt: 201 },
    { priceObservationId: 'price-1', marketCapObservationId: 'cap-1' },
    { marketCapSource: 'DEXSCREENER' },
    { priceProvenance: 'MARKET_CAP_DERIVED' },
    { address: 'not-an-address' }
  ]) {
    assert.deepEqual(Supply.resolve({ ...coherent, ...mismatch }), {
      totalSupply: 100_000_000_000, source: 'LAUNCHPAD_RULE', confidence: 'fallback'
    });
  }
});

test('launchpad and mode rules distinguish 1B, 2B, and 100B supplies', () => {
  assert.equal(Supply.ruleSupply('sol', 'Pump.fun', 'standard'), 1_000_000_000);
  assert.equal(Supply.ruleSupply('sol', 'Pump.fun', 'Mayhem'), 2_000_000_000);
  assert.equal(Supply.ruleSupply('base', 'Bankr', ''), 100_000_000_000);
  assert.equal(Supply.ruleSupply('robinhood', 'Clanker', ''), 100_000_000_000);
  assert.equal(Supply.ruleSupply('xlayer', 'DYOR', ''), 1_000_000_000);
});

test('verified launchpad rules expose supply and initial market cap', () => {
  const cases = [
    ['sol', 'pump.fun', '', 1_000_000_000],
    ['sol', 'pump.fun', 'mayhem', 2_000_000_000],
    ['base', 'clanker', '', 100_000_000_000],
    ['robinhood', 'bankr', '', 100_000_000_000],
    ['bsc', 'four.meme', '', 1_000_000_000],
    ['bsc', 'flap', '', 1_000_000_000],
    ['base', 'zora', '', 1_000_000_000],
    ['xlayer', 'bow.fun', '', 1_000_000_000]
  ];
  for (const [chain, launchpad, launchMode, totalSupply] of cases) {
    assert.deepEqual(Supply.launchpadRule(chain, launchpad, launchMode), {
      totalSupply,
      initialMarketCapUsd: 3_200,
      source: 'LAUNCHPAD_RULE'
    });
  }
});

test('unknown launchpads use the fixed 3200 USD and one-billion fallback', () => {
  assert.equal(Supply.UNKNOWN_INITIAL_MARKET_CAP_USD, 3_200);
  assert.equal(Supply.UNKNOWN_TOTAL_SUPPLY, 1_000_000_000);
  assert.deepEqual(Supply.fallbackValuation({ chain: 'eth', launchpad: 'unknown' }), {
    totalSupply: 1_000_000_000,
    marketCapUsd: 3_200,
    priceUsd: 0.0000032,
    supplySource: 'UNKNOWN_FALLBACK',
    valuationSource: 'UNKNOWN_INITIAL_MARKET_CAP'
  });
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
