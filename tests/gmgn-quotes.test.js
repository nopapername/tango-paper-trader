const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
require('../src/core/chains.js');
const Quotes = require('../src/adapters/gmgn-quotes.js');

const FIELD_PROVENANCE_KEYS = [
  'totalSupplyObservationSource', 'priceSource', 'marketCapSource',
  'totalSupplyField', 'totalSupplyTrustRank', 'totalSupplyAmbiguous',
  'liquidityObservedAt', 'liquiditySource', 'symbolObservedAt', 'symbolSource',
  'nameObservedAt', 'nameSource', 'logoUrlObservedAt', 'logoUrlSource',
  'launchpadObservedAt', 'launchpadSource', 'launchModeObservedAt', 'launchModeSource'
];
function withoutFieldProvenance(observation) {
  const copy = { ...observation };
  FIELD_PROVENANCE_KEYS.forEach((key) => delete copy[key]);
  return copy;
}

test('EVM quotes bind to one explicit active chain', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const quotes = Quotes.extract({ data: [{ address, price_usd: '2', market_cap: '2000' }] }, 'base', 123);
  assert.deepEqual(quotes.map(withoutFieldProvenance), [{
    chain: 'base', address: address.toLowerCase(), priceUsd: 2, marketCapUsd: 2000,
    liquidityUsd: 0, totalSupply: 0, totalSupplySource: '', symbol: '', name: '', logoUrl: '',
    launchpad: '', launchMode: '', priceObservedAt: 123, marketCapObservedAt: 123,
    totalSupplyObservedAt: 0, metadataObservedAt: 0, observedAt: 123, source: 'GMGN_NETWORK'
  }]);
  assert.equal(quotes[0].priceSource, 'GMGN_NETWORK');
  assert.equal(quotes[0].marketCapSource, 'GMGN_NETWORK');
});

test('invalid addresses and unknown chains are discarded', () => {
  assert.deepEqual(Quotes.extract({ address: 'bad', price: 1 }, 'eth', 123), []);
  assert.deepEqual(Quotes.extract({
    address: '0x1111111111111111111111111111111111111111', price: 1
  }, 'unknown', 123), []);
});

test('duplicate quote fragments do not treat a generic cross-fragment price as factual USD', () => {
  const address = 'So11111111111111111111111111111111111111112';
  const quotes = Quotes.extract({ data: [
    { mint: address, price: '$0.25', symbol: '$SOL', name: ' Solana ' },
    { token_address: address, market_cap: '2.5M', liquidity: { usd: '125K' }, logo_url: 'x'.repeat(1100) }
  ] }, 'sol', 456);
  assert.deepEqual(quotes.map(withoutFieldProvenance), [{
    chain: 'sol', address, priceUsd: 0, marketCapUsd: 2_500_000, liquidityUsd: 125_000,
    totalSupply: 0, totalSupplySource: '', symbol: 'SOL', name: 'Solana', logoUrl: 'x'.repeat(1000),
    launchpad: '', launchMode: '', priceObservedAt: 0, marketCapObservedAt: 456,
    totalSupplyObservedAt: 0, metadataObservedAt: 456, observedAt: 456, source: 'GMGN_NETWORK'
  }]);
  assert.equal(quotes[0].symbolObservedAt, 456);
  assert.equal(quotes[0].nameObservedAt, 456);
  assert.equal(quotes[0].logoUrlObservedAt, 456);
  assert.equal(quotes[0].liquiditySource, 'GMGN_NETWORK');
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

  assert.deepEqual(withoutFieldProvenance(Quotes.mergeObservation(full, priceOnly)), {
    ...full, priceUsd: 3, totalSupply: 0, totalSupplySource: '', launchpad: '', launchMode: '',
    observedAt: 200, priceObservedAt: 200, marketCapObservedAt: 100,
    totalSupplyObservedAt: 0, metadataObservedAt: 100
  });
  assert.deepEqual(withoutFieldProvenance(Quotes.mergeObservation(priceOnly, full)), {
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

test('supply-only and metadata-only exact-address fragments are retained', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [supplyOnly] = Quotes.extract({ token_address: address, total_supply: '2000000000' }, 'base', 600);
  assert.equal(supplyOnly.totalSupply, 2_000_000_000);
  assert.equal(supplyOnly.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.equal(supplyOnly.totalSupplyObservedAt, 600);
  assert.equal(supplyOnly.observedAt, 600);

  const [metadataOnly] = Quotes.extract({
    token_address: address,
    symbol: 'META',
    name: 'Metadata Token',
    logo_url: 'meta.png',
    launchpad: 'Clanker',
    launch_mode: 'standard'
  }, 'base', 700);
  assert.equal(metadataOnly.symbol, 'META');
  assert.equal(metadataOnly.name, 'Metadata Token');
  assert.equal(metadataOnly.logoUrl, 'meta.png');
  assert.equal(metadataOnly.launchpad, 'Clanker');
  assert.equal(metadataOnly.launchMode, 'standard');
  assert.equal(metadataOnly.observedAt, 700);
});

test('explicit total supply outranks nested generic supply at the same observation', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({
    address,
    total_supply: '100B',
    nested: { address, supply: '1B' }
  }, 'base', 800);
  assert.equal(quote.totalSupply, 100_000_000_000);
  assert.equal(quote.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.equal(quote.totalSupplyObservedAt, 800);
});

test('generic supply alone cannot claim exact GMGN supply trust', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({ address, supply: '1B', symbol: 'GENERIC' }, 'base', 801);
  assert.notEqual(quote.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.equal(quote.totalSupply, 0);
});

test('conflicting explicit supplies at one observation are ambiguous instead of traversal ordered', () => {
  const address = '0x1111111111111111111111111111111111111111';
  for (const data of [
    [{ address, total_supply: '100B' }, { address, totalSupply: '1B' }],
    [{ address, totalSupply: '1B' }, { address, total_supply: '100B' }]
  ]) {
    const [quote] = Quotes.extract({ data, symbol: 'CONFLICT' }, 'base', 802);
    assert.equal(quote.totalSupply, 0);
    assert.equal(quote.totalSupplySource, '');
    assert.equal(quote.totalSupplyAmbiguous, true);
  }
});

function assertAmbiguousExactSupply(quote) {
  assert.equal(quote.totalSupply, 0);
  assert.equal(quote.totalSupplySource, '');
  assert.equal(quote.totalSupplyAmbiguous, true);
}

test('same-time exact supply followed by an internally ambiguous fragment stays ambiguous', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({ data: [
    { address, total_supply: '100B' },
    { address, total_supply: '100B', totalSupply: '1B' }
  ] }, 'base', 803);

  assertAmbiguousExactSupply(quote);
});

test('same-time internally ambiguous supply followed by exact supply stays ambiguous', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({ data: [
    { address, total_supply: '100B', totalSupply: '1B' },
    { address, total_supply: '100B' }
  ] }, 'base', 803);

  assertAmbiguousExactSupply(quote);
});

test('an older ambiguous supply cannot overwrite a newer trusted exact supply', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const newerExact = Quotes.mergeObservation(null, {
    chain: 'base', address,
    totalSupply: 100_000_000_000,
    totalSupplySource: 'GMGN_NETWORK_EXACT',
    observedAt: 200, source: 'GMGN_NETWORK'
  });
  const merged = Quotes.mergeObservation(newerExact, {
    chain: 'base', address,
    totalSupply: 0,
    totalSupplyAmbiguous: true,
    observedAt: 100, source: 'GMGN_NETWORK'
  });

  assert.equal(merged.totalSupply, 100_000_000_000);
  assert.equal(merged.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.notEqual(merged.totalSupplyAmbiguous, true);
  assert.equal(merged.totalSupplyObservedAt, 200);
});

test('an object with conflicting valid address aliases is rejected entirely', () => {
  const first = '0x1111111111111111111111111111111111111111';
  const second = '0x2222222222222222222222222222222222222222';
  assert.deepEqual(Quotes.extract({
    address: first, token_address: second, price_usd: '2', total_supply: '100B'
  }, 'base', 803), []);
});

test('only explicit or dimensionally proven generic prices become factual USD prices', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [explicit] = Quotes.extract({ address, price_usd: '0.000032' }, 'base', 804);
  assert.equal(explicit.priceUsd, 0.000032);
  assert.equal(explicit.priceSource, 'GMGN_NETWORK');

  const [generic] = Quotes.extract({ address, price: '0.000032', symbol: 'GENERIC' }, 'base', 805);
  assert.equal(generic.priceUsd, 0);
  assert.equal(generic.priceSource, '');

  const [proven] = Quotes.extract({
    address, price: '0.000032', market_cap: '3.2M', total_supply: '100B'
  }, 'base', 806);
  assert.equal(proven.priceUsd, 0.000032);
  assert.equal(proven.marketCapUsd, 3_200_000);
  assert.equal(proven.totalSupply, 100_000_000_000);
});

test('a contradictory price market-cap supply triple cannot calibrate any dimension', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({
    address,
    price_usd: '0.000032',
    market_cap: '3200',
    total_supply: '100B',
    symbol: 'CONTRADICTORY'
  }, 'base', 807);
  assert.equal(quote.priceUsd, 0);
  assert.equal(quote.marketCapUsd, 0);
  assert.equal(quote.totalSupply, 0);
  assert.equal(quote.totalSupplySource, '');
});

function assertAmbiguousContradictoryDimensions(quote) {
  assert.equal(quote.priceUsd, 0);
  assert.equal(quote.marketCapUsd, 0);
  assert.equal(quote.totalSupply, 0);
  assert.equal(quote.totalSupplySource, '');
  assert.equal(quote.totalSupplyAmbiguous, true);
}

test('a valuation fragment followed by contradictory exact supply stays ambiguous', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({ data: [
    { address, price_usd: '0.000032', market_cap: '3200' },
    { address, total_supply: '100B' }
  ] }, 'base', 808);

  assertAmbiguousContradictoryDimensions(quote);
});

test('contradictory exact supply followed by a valuation fragment stays ambiguous', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const [quote] = Quotes.extract({ data: [
    { address, total_supply: '100B' },
    { address, price_usd: '0.000032', market_cap: '3200' }
  ] }, 'base', 809);

  assertAmbiguousContradictoryDimensions(quote);
});

test('a newer independent explicit price does not invalidate older coherent cap and supply fields', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const coherent = Quotes.mergeObservation(null, {
    chain: 'base', address,
    priceUsd: 1, marketCapUsd: 1_000, totalSupply: 1_000,
    totalSupplySource: 'GMGN_NETWORK_EXACT',
    observedAt: 100, source: 'GMGN_NETWORK'
  });
  const merged = Quotes.mergeObservation(coherent, {
    chain: 'base', address,
    priceUsd: 2, observedAt: 200, source: 'GMGN_NETWORK'
  });

  assert.equal(merged.priceUsd, 2);
  assert.equal(merged.priceObservedAt, 200);
  assert.equal(merged.marketCapUsd, 1_000);
  assert.equal(merged.marketCapObservedAt, 100);
  assert.equal(merged.totalSupply, 1_000);
  assert.equal(merged.totalSupplyObservedAt, 100);
  assert.equal(merged.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.notEqual(merged.totalSupplyAmbiguous, true);
});

test('each metadata field keeps independent time and source provenance', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const newerSymbol = {
    chain: 'eth', address, symbol: 'NEW', observedAt: 200,
    metadataObservedAt: 200, source: 'GMGN_NETWORK'
  };
  const olderUniqueFields = {
    chain: 'eth', address, name: 'Older Name', logoUrl: 'older.png', launchpad: 'OlderPad',
    observedAt: 100, metadataObservedAt: 100, source: 'GMGN_NETWORK'
  };
  const merged = Quotes.mergeObservation(newerSymbol, olderUniqueFields);

  assert.equal(merged.symbol, 'NEW');
  assert.equal(merged.symbolObservedAt, 200);
  assert.equal(merged.name, 'Older Name');
  assert.equal(merged.nameObservedAt, 100);
  assert.equal(merged.logoUrl, 'older.png');
  assert.equal(merged.logoUrlObservedAt, 100);
  assert.equal(merged.launchpad, 'OlderPad');
  assert.equal(merged.launchpadObservedAt, 100);
  assert.equal(merged.symbolSource, 'GMGN_NETWORK');
  assert.equal(merged.nameSource, 'GMGN_NETWORK');
});

test('cross-source merges keep the winning valuation field source', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const gmgn = {
    chain: 'base', address, priceUsd: 1, totalSupply: 1_000_000_000,
    totalSupplySource: 'GMGN_NETWORK_EXACT', observedAt: 100, source: 'GMGN_NETWORK'
  };
  const dex = {
    chain: 'base', address, priceUsd: 2, observedAt: 200, source: 'DEXSCREENER'
  };
  const merged = Quotes.mergeObservation(gmgn, dex);

  assert.equal(merged.priceUsd, 2);
  assert.equal(merged.priceSource, 'DEXSCREENER');
  assert.equal(merged.source, 'DEXSCREENER');
  assert.equal(merged.totalSupply, 1_000_000_000);
  assert.equal(merged.totalSupplySource, 'GMGN_NETWORK_EXACT');
  assert.equal(merged.totalSupplyObservationSource, 'GMGN_NETWORK');
});

test('merging rejects untrusted or synthetic-derived prices and preserves factual provenance', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const factual = Quotes.mergeObservation(null, {
    chain: 'base', address, priceUsd: 2, observedAt: 100,
    source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE'
  });

  assert.equal(factual.priceProvenance, 'OBSERVED_PRICE');
  for (const poison of [
    { source: 'PAGE_TEXT' },
    { source: 'GMGN_NETWORK', syntheticTokenPrice: true, priceProvenance: 'SYNTHETIC_PRICE' },
    { source: 'GMGN_NETWORK', priceProvenance: 'MARKET_CAP_DERIVED' }
  ]) {
    const merged = Quotes.mergeObservation(factual, {
      chain: 'base', address, priceUsd: 9, observedAt: 200, ...poison
    });
    assert.equal(merged.priceUsd, 2, poison.source);
    assert.equal(merged.priceSource, 'GMGN_NETWORK', poison.source);
    assert.equal(merged.priceProvenance, 'OBSERVED_PRICE', poison.source);
  }
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

test('invalid values and timestamps are ignored per field without freezing later observations', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const valid = Quotes.mergeObservation(null, {
    chain: 'eth', address, priceUsd: 2, symbol: 'VALID', observedAt: 100, source: 'GMGN_NETWORK'
  });
  const poisoned = Quotes.mergeObservation(valid, {
    chain: 'eth', address,
    priceUsd: Infinity, priceObservedAt: 200,
    totalSupply: Infinity, totalSupplyObservedAt: 200,
    symbol: 'POISON', symbolObservedAt: Number.MAX_SAFE_INTEGER,
    name: 'Fresh Name', nameObservedAt: 200,
    observedAt: Number.MAX_SAFE_INTEGER, source: 'GMGN_NETWORK'
  });

  assert.equal(poisoned.priceUsd, 2);
  assert.equal(poisoned.totalSupply, 0);
  assert.equal(poisoned.symbol, 'VALID');
  assert.equal(poisoned.name, 'Fresh Name');
  const recovered = Quotes.mergeObservation(poisoned, {
    chain: 'eth', address, priceUsd: 3, observedAt: 300, source: 'GMGN_NETWORK'
  });
  assert.equal(recovered.priceUsd, 3);
  assert.equal(recovered.priceObservedAt, 300);
});

test('native price extraction rejects generic price without trusted endpoint context', () => {
  assert.deepEqual(Quotes.extractNativePrices({ data: [
    { symbol: 'SOL', price: '150' },
    { symbol: 'ETH', price_usd: '3500' },
    { symbol: 'RANDOM', price: '9' }
  ] }, 700), [
    { symbol: 'ETH', priceUsd: 3500, observedAt: 700, source: 'GMGN_MAJOR_COIN' }
  ]);
});

test('generic native price requires the exact GMGN major-coin endpoint and a non-token entry', () => {
  const payload = { data: [{ symbol: 'SOL', price: '150' }] };
  const trusted = { requestUrl: 'https://gmgn.ai/api/v1/major_coin_prices?chain=all' };
  assert.deepEqual(Quotes.extractNativePrices(payload, 701, trusted), [
    { symbol: 'SOL', priceUsd: 150, observedAt: 701, source: 'GMGN_MAJOR_COIN' }
  ]);

  for (const context of [
    { allowGenericPrice: true },
    { requestUrl: 'https://example.com/api/v1/major_coin_prices' },
    { requestUrl: 'https://gmgn.ai/api/v1/major_coin_prices/extra' }
  ]) {
    assert.deepEqual(Quotes.extractNativePrices(payload, 701, context), []);
  }
  assert.deepEqual(Quotes.extractNativePrices({
    data: [{
      address: '0x1111111111111111111111111111111111111111',
      symbol: 'ETH',
      price: '3500'
    }]
  }, 701, trusted), []);
});
