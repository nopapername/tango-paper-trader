const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Tango = {};
require('../src/core/chains.js');
const { buildPayload } = require('../src/content/markers.js');
const chartSource = fs.readFileSync(path.resolve(__dirname, '../src/content/chart-main.js'), 'utf8');

const ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
const labels = { entry: 'Paper Buy', exit: 'Paper Sell', hide: 'Hide line' };

function loadChartBridge() {
  const listeners = new Map();
  const makeElement = () => {
    const children = [];
    return {
      id: '', isConnected: true, style: {}, children,
      get childElementCount() { return children.length; },
      append(...nodes) { children.push(...nodes); },
      appendChild(node) { children.push(node); return node; },
      replaceChildren(...nodes) { children.splice(0, children.length, ...nodes); },
      addEventListener() {}, setAttribute() {}
    };
  };
  const instrumented = chartSource.replace(
    '  setInterval(renderMarkers, 400);',
    `  window.__chartTest = {
      seedEmptyCaches() {
        lastScaleMode = { type: 'PRICE', factor: 1 };
        stableScale = { type: 'PRICE', factor: 1 };
        stableSignature = 'stale-scale';
        renderedSignature = 'stale-render';
        markerPositions.set('stale', 123);
        ensureOverlay().replaceChildren(document.createElement('div'));
      },
      snapshot() {
        return {
          markerState, lastScaleMode, stableScale, stableSignature, renderedSignature,
          markerPositions: [...markerPositions], overlayChildren: overlay?.childElementCount || 0
        };
      }
    };
    setInterval(renderMarkers, 400);`
  );
  const context = {
    console, Date, Map, WeakMap, Set, Math, Number,
    innerWidth: 1200, innerHeight: 800,
    document: {
      body: makeElement(), documentElement: makeElement(), createElement: makeElement
    },
    setInterval() { return 0; }
  };
  context.window = {
    top: {}, frameElement: { title: 'Financial Chart' }, parent: { postMessage() {} },
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  context.window.window = context.window;
  Object.assign(context.window, context);
  require('node:vm').runInNewContext(instrumented, context.window, { filename: 'src/content/chart-main.js' });
  return { api: context.window.__chartTest, message: (data) => listeners.get('message')({ data }) };
}

test('returns the existing empty marker shape without a current token', () => {
  assert.deepEqual(buildPayload({ current: null, position: null, trades: [], labels }), { markers: [] });
});

test('position entry wins and the first four matching sells keep trade order', () => {
  const current = {
    token: { chain: 'sol', address: ADDRESS },
    quote: { priceUsd: 2, marketCapUsd: 2_000 }
  };
  const trades = [
    { id: 'sell-1', chain: 'sol', tokenAddress: ADDRESS.toLowerCase(), side: 'SELL', amountNative: 1, nativePriceUsd: 100, marketCapUsd: 1_500, observedPriceUsd: 1.5 },
    { id: 'buy-1', chain: 'sol', tokenAddress: ADDRESS, side: 'BUY', amountNative: 1, nativePriceUsd: 100, marketCapUsd: 1_200, observedPriceUsd: 1.2 },
    { id: 'sell-2', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', amountNative: 1, nativePriceUsd: 100, marketCapUsd: 1_600, observedPriceUsd: 0 },
    { id: 'wrong-chain', chain: 'eth', tokenAddress: ADDRESS, side: 'SELL', amountNative: 9, nativePriceUsd: 3_000, marketCapUsd: 9_999, observedPriceUsd: 9.9 },
    { id: 'sell-3', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', amountNative: 1, nativePriceUsd: 100, marketCapUsd: 1_700, observedPriceUsd: 1.7 },
    { id: 'sell-4', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', amountNative: 1, nativePriceUsd: 100, marketCapUsd: 1_800, observedPriceUsd: 1.8 },
    { id: 'sell-5', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', amountNative: 1, nativePriceUsd: 100, marketCapUsd: 1_900, observedPriceUsd: 1.9 }
  ];

  const payload = buildPayload({
    current,
    position: { averageEntryMarketCap: 1_000, averageEntryPriceUsd: 1 },
    trades,
    labels
  });

  assert.deepEqual(payload, {
    chain: 'sol',
    tokenAddress: ADDRESS,
    currentPrice: 2,
    currentMarketCap: 2_000,
    markers: [
      { id: `entry:sol:${ADDRESS}`, side: 'BUY', marketCap: 1_000, price: 1, label: 'Paper Buy', closeLabel: 'Hide line' },
      { id: `sell:sol:${ADDRESS}:sell-2`, side: 'SELL', marketCap: 1_600, price: 1.6, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: `sell:sol:${ADDRESS}:sell-3`, side: 'SELL', marketCap: 1_700, price: 1.7, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: `sell:sol:${ADDRESS}:sell-4`, side: 'SELL', marketCap: 1_800, price: 1.8, label: 'Paper Sell', closeLabel: 'Hide line' },
      { id: `sell:sol:${ADDRESS}:sell-5`, side: 'SELL', marketCap: 1_900, price: 1.9, label: 'Paper Sell', closeLabel: 'Hide line' }
    ]
  });
});

test('synthetic market-cap prices stay off the price axis until a real ratio reference exists', () => {
  const current = {
    token: { chain: 'sol', address: ADDRESS },
    quote: {
      priceUsd: 0, marketCapUsd: 2_000, valuationMode: 'MARKET_CAP',
      priceProvenance: 'MARKET_CAP_DERIVED'
    }
  };
  const payload = buildPayload({
    current,
    position: {
      averageEntryMarketCap: 1_000, averageEntryPriceUsd: 0.000001,
      valuationMode: 'MARKET_CAP', averageEntryPriceProvenance: 'MARKET_CAP_DERIVED'
    },
    trades: [
      { chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', amountNative: 1, nativePriceUsd: 100, marketCapUsd: 1_500, observedPriceUsd: 0.0000015, executedAt: 123, priceProvenance: 'MARKET_CAP_DERIVED' }
    ],
    labels
  });

  assert.equal(payload.markers[0].price, 0);
  assert.equal(payload.markers[1].price, 0);
  assert.equal(payload.currentMarketCap, 2_000);
  assert.equal(payload.markers[0].marketCap, 1_000);
  assert.equal(payload.markers[1].marketCap, 1_500);

  const withRealReference = buildPayload({
    current: { ...current, quote: { priceUsd: 0.000002, marketCapUsd: 2_000, priceProvenance: 'OBSERVED_PRICE' } },
    position: {
      averageEntryMarketCap: 1_000, averageEntryPriceUsd: 0.000001,
      valuationMode: 'MARKET_CAP', averageEntryPriceProvenance: 'MARKET_CAP_DERIVED'
    },
    trades: payload.markers.slice(1).map(() => ({
      chain: 'sol', tokenAddress: ADDRESS, side: 'SELL', marketCapUsd: 1_500,
      observedPriceUsd: 0.0000015, executedAt: 123, priceProvenance: 'MARKET_CAP_DERIVED'
    })),
    labels
  });
  assert.equal(withRealReference.markers[0].price, 0.000001);
  assert.equal(withRealReference.markers[1].price, 0.0000015);
  assert.deepEqual(payload.markers[1], {
    id: `sell:sol:${ADDRESS}:123:1500`, side: 'SELL', marketCap: 1_500, price: 0,
    label: 'Paper Sell', closeLabel: 'Hide line'
  });
});

test('chart cache identity includes chain as well as token address', () => {
  assert.match(chartSource, /markerState\?\.chain !== nextState\?\.chain/);
  assert.match(chartSource, /markerState\?\.tokenAddress !== nextState\?\.tokenAddress/);
});

test('an empty marker payload clears overlay and every cached chart placement', () => {
  const chart = loadChartBridge();
  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: { markers: [] } });
  chart.api.seedEmptyCaches();

  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: { markers: [] } });

  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), {
    markerState: { markers: [] },
    lastScaleMode: null,
    stableScale: null,
    stableSignature: '',
    renderedSignature: '',
    markerPositions: [],
    overlayChildren: 0
  });
});
