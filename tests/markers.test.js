const test = require('node:test');
const assert = require('node:assert/strict');

global.Tango = {};
const { buildPayload } = require('../src/content/markers.js');

const ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
const labels = { entry: 'Paper Buy', exit: 'Paper Sell', hide: 'Hide line' };

test('returns the existing empty marker shape without a current token', () => {
  assert.deepEqual(buildPayload({ current: null, position: null, trades: [], labels }), { markers: [] });
});

test('position entry wins and the first four matching sells keep trade order', () => {
  const current = {
    token: { chain: 'sol', address: ADDRESS },
    quote: { priceUsd: 2, marketCapUsd: 2_000 }
  };
  const trades = [
    { id: 'sell-1', chain: 'sol', tokenAddress: ADDRESS.toLowerCase(), side: 'SELL', marketCapUsd: 1_500, observedPriceUsd: 1.5 },
    { id: 'buy-1', chain: 'sol', tokenAddress: ADDRESS, side: 'BUY', marketCapUsd: 1_200, observedPriceUsd: 1.2 },
    { id: 'sell-2', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_600, observedPriceUsd: 0 },
    { id: 'wrong-chain', chain: 'eth', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 9_999, observedPriceUsd: 9.9 },
    { id: 'sell-3', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_700, observedPriceUsd: 1.7 },
    { id: 'sell-4', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_800, observedPriceUsd: 1.8 },
    { id: 'sell-5', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_900, observedPriceUsd: 1.9 }
  ];

  const payload = buildPayload({
    current,
    position: { averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1 },
    trades,
    labels
  });

  assert.deepEqual(payload, {
    tokenAddress: ADDRESS.toLowerCase(),
    currentPrice: 2,
    currentMarketCap: 2_000,
    markers: [
      { id: `entry:${ADDRESS.toLowerCase()}`, side: 'BUY', marketCap: 1_000, price: 1, label: 'Paper Buy', closeLabel: 'Hide line' },
      { id: 'sell:sell-1', side: 'SELL', marketCap: 1_500, price: 1.5, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: 'sell:sell-2', side: 'SELL', marketCap: 1_600, price: 1.6, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: 'sell:sell-3', side: 'SELL', marketCap: 1_700, price: 1.7, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: 'sell:sell-4', side: 'SELL', marketCap: 1_800, price: 1.8, label: 'Paper Sell', closeLabel: 'Hide line' }
    ]
  });
});

test('first matching buy is the fallback entry and missing trade ids keep the legacy id', () => {
  const current = {
    token: { chain: 'sol', address: ADDRESS },
    quote: { priceUsd: 0.000002, marketCapUsd: 2_000 }
  };
  const payload = buildPayload({
    current,
    position: null,
    trades: [
      { chain: 'sol', tokenAddress: ADDRESS, side: 'BUY', marketCapUsd: 1_000, observedPriceUsd: 0 },
      { chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_500, observedPriceUsd: 0, executedAt: 123 }
    ],
    labels
  });

  assert.equal(payload.markers[0].price, 0.000001);
  assert.deepEqual(payload.markers[1], {
    id: 'sell:123:1500', side: 'SELL', marketCap: 1_500, price: 0.0000015,
    label: 'Paper Sell', closeLabel: 'Hide line'
  });
});
