const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.Tango = {};
require('../src/core/chains.js');
require('../src/core/supply.js');
require('../src/shared/constants.js');
const State = require('../src/core/state.js');
const Engine = require('../src/core/engine.js');
const StateCoordinator = require('../src/core/state-coordinator.js');
const { buildPayload } = require('../src/content/markers.js');
const chartSource = fs.readFileSync(path.resolve(__dirname, '../src/content/chart-main.js'), 'utf8');

const ADDRESS = 'AbCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP';
const BSC_ADDRESS = '0x1111111111111111111111111111111111111111';
const BSC_OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';
const labels = { entry: 'Paper Buy', exit: 'Paper Sell', hide: 'Hide line' };

function durableUnknownFallback(overrides = {}) {
  return {
    chain: 'base', tokenAddress: BSC_ADDRESS, side: 'BUY', id: 'fallback',
    marketCapUsd: 3_200, observedPriceUsd: 0.0000032,
    quoteSource: 'TANGO_FALLBACK', paperFallback: true, provisional: true,
    syntheticTokenPrice: true, valuationMode: 'MARKET_CAP',
    priceProvenance: 'SYNTHETIC_PRICE', totalSupply: 1_000_000_000,
    marketCapDivisor: 1_000_000_000, provisionalSupply: 1_000_000_000,
    provisionalSupplyProvenance: 'TANGO_INTERNAL_UNKNOWN_FALLBACK_V1',
    supplySource: 'UNKNOWN_FALLBACK', executedAt: 1_000,
    ...overrides
  };
}

function loadChartBridge({
  frameTitle = 'Financial Chart',
  href = `https://gmgn.ai/bsc/token/${BSC_ADDRESS}`,
  referrer = '',
  topHref = '',
  topAccessible = true,
  frameInTradingView = false,
  canvasRect: initialCanvasRect = { left: 0, top: 0, width: 1_200, height: 700 },
  viewport: initialViewport = { width: 1_200, height: 800 }
} = {}) {
  const listeners = new Map();
  const parentMessages = [];
  const clock = { now: 1_000 };
  const canvasRect = { ...initialCanvasRect };
  const viewport = { ...initialViewport };
  const defaultFrameContext = {
    axisHint: 'UNKNOWN',
    frameGeneration: 1,
    probeId: 'test:1'
  };
  class FakeDate extends Date { static now() { return clock.now; } }
  class FakeCanvasRenderingContext2D {
    constructor(canvas) {
      this.canvas = canvas;
      this.transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }
    fillText() {}
    strokeText() {}
    clearRect() {}
    getTransform() {
      const { a, b, c, d, e, f } = this.transform;
      return {
        a, b, c, d, e, f,
        transformPoint: ({ x, y }) => ({ x: a * x + c * y + e, y: b * x + d * y + f })
      };
    }
    setTransform(a, b, c, d, e, f) { this.transform = { a, b, c, d, e, f }; }
  }
  class FakeHTMLCanvasElement {
    constructor(rect) {
      this.isConnected = true;
      this.width = 1_000;
      this.height = 700;
      this.rect = rect;
      this.transferred = false;
    }
    getBoundingClientRect() { return { ...this.rect }; }
    transferControlToOffscreen() {
      this.transferred = true;
      return { width: this.width, height: this.height };
    }
  }
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
        markerEconomicCoordinates.set('stale', 'PRICE:1:123');
        ensureOverlay().replaceChildren(document.createElement('div'));
      },
      snapshot() {
        return {
          markerState, lastScaleMode, stableScale, stableSignature, renderedSignature,
          frameContext: typeof activeFrameContext === 'undefined' ? null : activeFrameContext,
          observedProbe: typeof observedFrameProbe === 'undefined' ? null : observedFrameProbe,
          markerPositions: [...markerPositions], markerEconomicCoordinateCount: markerEconomicCoordinates.size,
          overlayChildren: overlay?.childElementCount || 0,
          overlayTops: overlay?.children?.map((node) => node.style.top) || [],
          overlayStyles: overlay?.children?.map((node) => ({ ...node.style })) || [],
          diagnostic: typeof chartDiagnostic === 'undefined'
            ? null
            : JSON.parse(JSON.stringify(chartDiagnostic))
        };
      },
      trackedCanvasCount() { return labelsByCanvas.size; },
      hideMarker(id) { hiddenMarkerIds.add(id); renderMarkers(); },
      record(context, text, x, y) { recordLabel(context, text, x, y); },
      seedAxisRecords(context, samples) {
        const id = canvasId(context.canvas);
        const records = new Map();
        const observedRect = context.canvas.getBoundingClientRect();
        const observedSourceSignature = typeof sourceObservationSignature === 'function'
          ? sourceObservationSignature(observedRect, context.canvas)
          : '';
        samples.forEach((sample) => records.set(sample.text, {
          text: sample.text, value: parseNumber(sample.text), y: sample.y, x: 950, id,
          generation: sample.generation, sequence: ++axisLabelSequence, updatedAt: sample.updatedAt,
          sourceObservationSignature: observedSourceSignature
        }));
        labelsByCanvas.set(id, { canvas: context.canvas, records });
      },
      render: renderMarkers
    };
    setInterval(renderMarkers, 400);`
  );
  const location = { href };
  const context = {
    console, Date: FakeDate, JSON, Map, WeakMap, Set, Math, Number,
    location, URL,
    innerWidth: viewport.width, innerHeight: viewport.height,
    HTMLCanvasElement: FakeHTMLCanvasElement,
    CanvasRenderingContext2D: FakeCanvasRenderingContext2D,
    document: {
      body: makeElement(), documentElement: makeElement(), createElement: makeElement, referrer
    },
    setInterval() { return 0; }
  };
  const top = {};
  Object.defineProperty(top, 'location', {
    get() {
      if (!topAccessible) throw new Error('cross-origin top');
      return { href: topHref };
    }
  });
  context.window = {
    top,
    frameElement: {
      title: frameTitle,
      closest(selector) {
        return frameInTradingView && selector === '[data-sentry-component="TradingView"]' ? {} : null;
      }
    },
    parent: { postMessage(message) { parentMessages.push(message); } },
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  context.window.window = context.window;
  Object.assign(context.window, context);
  require('node:vm').runInNewContext(instrumented, context.window, { filename: 'src/content/chart-main.js' });
  const canvas = new FakeHTMLCanvasElement(canvasRect);
  const canvasContext = new FakeCanvasRenderingContext2D(canvas);
  const dispatchMessage = (data, source = context.window.parent) => {
    listeners.get('message')({ data, source });
  };
  const dispatchProbe = (frameContext = defaultFrameContext) => {
    dispatchMessage({
      source: 'TANGO_PAPER_PARENT',
      type: 'CHART_READY_PROBE',
      probeId: frameContext?.probeId,
      frameGeneration: frameContext?.frameGeneration
    });
  };
  return {
    api: context.window.__chartTest, bridgeInitialized: Boolean(context.window.__tangoPaperChartBridge),
    clock, canvasContext, parentMessages,
    message: (data, source = context.window.parent) => {
      const isParentMarker = source === context.window.parent
        && data?.source === 'TANGO_PAPER_PARENT'
        && data?.type === 'CHART_MARKERS';
      const delivered = isParentMarker
        && data?.type === 'CHART_MARKERS'
        && !Object.prototype.hasOwnProperty.call(data, 'context')
        ? { ...data, context: { ...defaultFrameContext } }
        : data;
      if (isParentMarker) dispatchProbe(delivered.context);
      dispatchMessage(delivered, source);
    },
    rawMessage: (data, source = context.window.parent) => {
      dispatchMessage(data, source);
    },
    probe: dispatchProbe,
    markers: (payload, frameContext = defaultFrameContext) => {
      dispatchProbe(frameContext);
      dispatchMessage({
        source: 'TANGO_PAPER_PARENT',
        type: 'CHART_MARKERS',
        context: { ...frameContext },
        payload
      });
    },
    setHref: (nextHref) => { location.href = nextHref; },
    setCanvasRect(next) { Object.assign(canvasRect, next); },
    setViewport(next) {
      Object.assign(viewport, next);
      context.window.innerWidth = viewport.width;
      context.window.innerHeight = viewport.height;
    },
    resize: () => listeners.get('resize')(),
    clear: () => canvasContext.clearRect(0, 0, canvas.width, canvas.height),
    createCanvasContext: () => new FakeCanvasRenderingContext2D(
      new FakeHTMLCanvasElement({ ...canvasRect })
    )
  };
}

test('chart child recovers a dropped startup READY from one exact probe without marker feedback', () => {
  const chart = loadChartBridge();
  const readyMessages = () => chart.parentMessages.filter((message) => (
    message?.source === 'TANGO_PAPER_CHART' && message?.type === 'READY'
  ));

  assert.equal(readyMessages().length, 1, 'the child keeps its spontaneous document-start READY');
  chart.parentMessages.length = 0;

  chart.message({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_READY_PROBE',
    probeId: 'probe-1',
    frameGeneration: 1
  });
  assert.equal(readyMessages().length, 1, 'one parent probe recovers one child READY');
  assert.equal(readyMessages()[0].probeId, 'probe-1', 'the child correlates the READY to its exact probe');
  assert.equal(readyMessages()[0].frameGeneration, 1, 'the child echoes the exact probe generation');

  for (let index = 0; index < 20; index += 1) {
    chart.rawMessage({
      source: 'TANGO_PAPER_PARENT',
      type: 'CHART_MARKERS',
      context: { axisHint: 'UNKNOWN', frameGeneration: 1, probeId: 'probe-1' },
      payload: { markers: [] }
    });
  }
  assert.equal(readyMessages().length, 1, 'marker delivery never creates a READY feedback loop');
});

test('chart READY reports child URL identity instead of adopting parent marker identity', () => {
  const chart = loadChartBridge({
    href: `https://gmgn.ai/sol/token/${ADDRESS}`
  });
  chart.parentMessages.length = 0;

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'base', tokenAddress: '0x2222222222222222222222222222222222222222',
      markers: []
    }
  });
  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_READY_PROBE', probeId: 'identity-probe', frameGeneration: 1 });

  const ready = chart.parentMessages.find((message) => message?.type === 'READY');
  assert.equal(ready?.identity?.chain, 'sol');
  assert.equal(ready?.identity?.address, ADDRESS);
});

test('chart READY recovers blob-frame identity from a same-origin GMGN detail referrer', () => {
  const chart = loadChartBridge({
    href: 'blob:https://gmgn.ai/4e6d6288-f914-46ce-a03b-42c722afca93',
    referrer: `https://gmgn.ai/bsc/token/${BSC_ADDRESS}`
  });
  chart.parentMessages.length = 0;

  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_READY_PROBE', probeId: 'blob-probe', frameGeneration: 1 });

  const ready = chart.parentMessages.find((message) => message?.type === 'READY');
  assert.equal(ready?.probeId, 'blob-probe');
  assert.equal(ready?.identity?.chain, 'bsc');
  assert.equal(ready?.identity?.address, BSC_ADDRESS);
});

test('chart READY prefers same-origin top detail identity for a reused blob frame', () => {
  const chart = loadChartBridge({
    href: 'blob:https://gmgn.ai/4e6d6288-f914-46ce-a03b-42c722afca93',
    topHref: `https://gmgn.ai/bsc/token/${BSC_ADDRESS}`,
    referrer: `https://gmgn.ai/sol/token/${ADDRESS}`
  });
  chart.parentMessages.length = 0;

  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_READY_PROBE', probeId: 'top-probe', frameGeneration: 1 });

  const ready = chart.parentMessages.find((message) => message?.type === 'READY');
  assert.equal(ready?.identity?.chain, 'bsc');
  assert.equal(ready?.identity?.address, BSC_ADDRESS);
});

test('chart READY fails closed when top detail identity is inaccessible', () => {
  const chart = loadChartBridge({
    href: 'about:blank',
    topAccessible: false,
    referrer: `https://gmgn.ai/bsc/token/${BSC_ADDRESS}`
  });
  chart.parentMessages.length = 0;

  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_READY_PROBE', probeId: 'blocked-top', frameGeneration: 1 });

  const ready = chart.parentMessages.find((message) => message?.type === 'READY');
  assert.equal(ready?.identity, undefined);
});

test('a non-parent marker sender cannot inject or clear chart state', () => {
  const chart = loadChartBridge({
    href: `https://gmgn.ai/bsc/token/${BSC_ADDRESS}`
  });
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const currentPayload = {
    chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_000, currentPrice: 0,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
  };

  chart.message(
    { source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: currentPayload },
    {}
  );
  assert.equal(chart.api.snapshot().markerState, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: currentPayload });
  const beforeForgedClear = JSON.parse(JSON.stringify(chart.api.snapshot()));
  assert.equal(beforeForgedClear.overlayChildren, 1);
  chart.message(
    { source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: { markers: [] } },
    {}
  );
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), beforeForgedClear);
});

test('malformed parent marker messages cannot crash or corrupt the current chart state', () => {
  const chart = loadChartBridge({
    href: `https://gmgn.ai/bsc/token/${BSC_ADDRESS}`
  });
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_000, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
    }
  });
  const beforeMalformed = JSON.parse(JSON.stringify(chart.api.snapshot()));

  for (const message of [
    null,
    { source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS' },
    { source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: null },
    { source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: { markers: {} } },
    { source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: { markers: [null] } }
  ]) {
    assert.doesNotThrow(() => chart.message(message));
    assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), beforeMalformed);
  }
});

test('a trusted parent payload for another token cannot replace or clear current-token markers', () => {
  const chart = loadChartBridge({
    href: `https://gmgn.ai/bsc/token/${BSC_ADDRESS}`
  });
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_000, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
    }
  });
  const beforeCrossToken = JSON.parse(JSON.stringify(chart.api.snapshot()));

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'base', tokenAddress: '0x2222222222222222222222222222222222222222',
      currentMarketCap: 6_000, currentPrice: 0,
      markers: [{ id: 'other', side: 'BUY', marketCap: 6_000, price: 0, label: 'Other Buy' }]
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), beforeCrossToken);
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: '0x2222222222222222222222222222222222222222',
      markers: []
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), beforeCrossToken);
});

test('the trusted parent can draw and clear markers for the independently derived current token', () => {
  const mixedCaseAddress = '0xA111111111111111111111111111111111111111';
  const normalizedAddress = mixedCaseAddress.toLowerCase();
  const chart = loadChartBridge({
    href: `https://gmgn.ai/bsc/token/${mixedCaseAddress}`
  });
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'BSC', tokenAddress: normalizedAddress, currentMarketCap: 6_000, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: { chain: 'bsc', tokenAddress: normalizedAddress, markers: [] }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot().markerState)), {
    chain: 'bsc', tokenAddress: normalizedAddress, markers: []
  });
});

test('an identified payload is rejected when the chart child has no independent token identity', () => {
  const chart = loadChartBridge({ href: 'about:blank', topAccessible: false });
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_000, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().markerState, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('invalid EVM and Solana child addresses cannot authorize matching identified payloads', () => {
  const scenarios = [
    ['short EVM address', 'bsc', '0x111111111111111111111111111111111111111', 6_000],
    ['non-hex EVM address', 'bsc', '0xgg11111111111111111111111111111111111111', 6_000],
    ['wrong decoded Solana length', 'sol', '1111111111111111111111111111111', 6_000],
    ['invalid Solana alphabet', 'sol', '0bCdEf123456789abcdefghijkmnopqrstuvwxyzPUMP', 6_000]
  ];

  for (const [label, chain, address, marketCap] of scenarios) {
    const chart = loadChartBridge({ href: `https://gmgn.ai/${chain}/token/${address}` });
    for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    chart.message({
      source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
      payload: {
        chain, tokenAddress: address, currentMarketCap: marketCap, currentPrice: 0,
        markers: [{ id: 'buy', side: 'BUY', marketCap, price: 0, label: 'Paper Buy' }]
      }
    });
    assert.equal(chart.api.snapshot().markerState, null, label);
    assert.equal(chart.api.snapshot().overlayChildren, 0, label);
  }
});

test('valid Solana marker identity remains case-sensitive while exact draw and clear stay allowed', () => {
  const chart = loadChartBridge({ href: `https://gmgn.ai/sol/token/${ADDRESS}` });
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const marker = { id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' };

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'sol', tokenAddress: ADDRESS, currentMarketCap: 6_000, currentPrice: 0,
      markers: [marker]
    }
  });
  const exactState = JSON.parse(JSON.stringify(chart.api.snapshot()));
  assert.equal(exactState.overlayChildren, 1);

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'sol', tokenAddress: ADDRESS.toLowerCase(), currentMarketCap: 6_000, currentPrice: 0,
      markers: [{ ...marker, id: 'wrong-case' }]
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), exactState);

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: { chain: 'sol', tokenAddress: ADDRESS, markers: [] }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('invalid producer marker records cannot replace or clear current chart state', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const validMarker = {
    id: 'buy', side: 'BUY', marketCap: 6_000, price: 0,
    label: 'Paper Buy', closeLabel: 'Hide line'
  };
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_000, currentPrice: 0,
      markers: [validMarker]
    }
  });
  const beforeMalformedMarker = JSON.parse(JSON.stringify(chart.api.snapshot()));

  const invalidMarkers = [
    ['empty record', {}],
    ['missing id', { ...validMarker, id: undefined }],
    ['empty id', { ...validMarker, id: '' }],
    ['invalid side', { ...validMarker, side: 'HOLD' }],
    ['non-finite market cap', { ...validMarker, marketCap: Number.NaN, price: 2 }],
    ['negative market cap', { ...validMarker, marketCap: -1, price: 2 }],
    ['non-finite price', { ...validMarker, marketCap: 6_000, price: Number.POSITIVE_INFINITY }],
    ['negative price', { ...validMarker, marketCap: 6_000, price: -1 }],
    ['no usable coordinate', { ...validMarker, marketCap: 0, price: 0 }],
    ['missing label', { ...validMarker, label: undefined }],
    ['empty label', { ...validMarker, label: '' }],
    ['non-string label', { ...validMarker, label: 7 }],
    ['empty close label', { ...validMarker, closeLabel: '' }],
    ['non-string close label', { ...validMarker, closeLabel: 7 }]
  ];

  for (const [label, marker] of invalidMarkers) {
    assert.doesNotThrow(() => chart.message({
      source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
      payload: {
        chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_000, currentPrice: 0,
        markers: [marker]
      }
    }), label);
    assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), beforeMalformedMarker, label);
  }
});

test('returns the existing empty marker shape without a current token', () => {
  assert.deepEqual(buildPayload({ current: null, position: null, trades: [], labels }), { markers: [] });
});

test('position entry wins and the first four matching sells keep trade order', () => {
  const current = {
    token: { chain: 'sol', address: ADDRESS },
    quote: {
      priceUsd: 2, marketCapUsd: 2_000,
      source: 'GMGN_NETWORK', priceProvenance: 'OBSERVED_PRICE',
      priceObservedAt: 100, marketCapObservedAt: 100, observedAt: 100
    }
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
  assert.equal(payload.currentMarketCap, 0);
  assert.equal(payload.markers[0].marketCap, 1_000);
  assert.equal(payload.markers[1].marketCap, 1_500);

  const withRealReference = buildPayload({
    current: {
      ...current,
      quote: {
        priceUsd: 0.000002, marketCapUsd: 2_000,
        priceProvenance: 'OBSERVED_PRICE', source: 'GMGN_NETWORK',
        priceObservedAt: 100, marketCapObservedAt: 100, observedAt: 100
      }
    },
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

test('known execution supply maps fallback market-cap entries onto a factual price-only chart', () => {
  const supply = 100_000_000_000;
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: '0x1111111111111111111111111111111111111111' },
      quote: { priceUsd: 0.00000008, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: {
      chain: 'base', tokenAddress: '0x1111111111111111111111111111111111111111',
      averageEntryMarketCap: 3_200, averageEntryPriceUsd: 0.000000032,
      valuationMode: 'MARKET_CAP', averageEntryPriceProvenance: 'MARKET_CAP_DERIVED',
      totalSupply: supply, marketCapDivisor: supply, supplySource: 'LAUNCHPAD_RULE'
    },
    trades: [],
    labels
  });

  assert.equal(payload.currentPrice, 0.00000008);
  assert.equal(payload.currentMarketCap, 8_000);
  assert.equal(payload.markers[0].marketCap, 3_200);
  assert.equal(payload.markers[0].price, 0.000000032);
});

test('mixed fresh price and stale market cap prefer same-token execution supply', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const position = {
    chain: 'base', tokenAddress: address,
    averageEntryMarketCap: 500, averageEntryPriceUsd: 0.5,
    averageEntryPriceProvenance: 'MARKET_CAP_DERIVED',
    totalSupply: 1_000, supplySource: 'GMGN_EXACT'
  };
  const current = {
    token: { chain: 'base', address },
    quote: {
      priceUsd: 2, marketCapUsd: 1_000,
      priceSource: 'GMGN_NETWORK', marketCapSource: 'GMGN_NETWORK',
      priceObservedAt: 200, marketCapObservedAt: 100, observedAt: 200,
      priceProvenance: 'OBSERVED_PRICE'
    }
  };

  const mixed = buildPayload({ current, position, trades: [], labels });
  assert.equal(mixed.markers[0].price, 0.5);

  const sameObservation = buildPayload({
    current: {
      ...current,
      quote: { ...current.quote, marketCapObservedAt: 200 }
    },
    position,
    trades: [],
    labels
  });
  assert.equal(sameObservation.markers[0].price, 1);
  assert.equal(sameObservation.currentMarketCap, 1_000);
  assert.equal(mixed.currentMarketCap, 2_000);
});

test('incoherent observed market cap has no payload fallback without known supply', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address },
      quote: {
        priceUsd: 2, marketCapUsd: 1_000,
        priceSource: 'GMGN_NETWORK', marketCapSource: 'GMGN_NETWORK',
        priceObservedAt: 200, marketCapObservedAt: 100, observedAt: 200,
        priceProvenance: 'OBSERVED_PRICE'
      }
    },
    position: null,
    trades: [],
    labels
  });

  assert.equal(payload.currentPrice, 2);
  assert.equal(payload.currentMarketCap, 0);
});

test('untrusted execution supply cannot synthesize market-cap or marker price references', () => {
  const address = '0x1111111111111111111111111111111111111111';
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address },
      quote: { priceUsd: 2, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: {
      chain: 'base', tokenAddress: address,
      averageEntryMarketCap: 500, averageEntryPriceUsd: 0.5,
      averageEntryPriceProvenance: 'MARKET_CAP_DERIVED',
      totalSupply: 1_000, supplySource: 'UNKNOWN_FALLBACK'
    },
    trades: [],
    labels
  });

  assert.equal(payload.currentMarketCap, 0);
  assert.equal(payload.markers[0].price, 0);
});

test('factual BUY and SELL execution prices survive zero execution market caps', () => {
  const payload = buildPayload({
    current: {
      token: { chain: 'sol', address: ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: null,
    trades: [
      {
        id: 'price-only-buy', chain: 'sol', tokenAddress: ADDRESS, side: 'BUY',
        marketCapUsd: 0, observedPriceUsd: 0.0000012, priceProvenance: 'OBSERVED_PRICE'
      },
      {
        id: 'price-only-sell', chain: 'sol', tokenAddress: ADDRESS, side: 'SELL',
        marketCapUsd: 0, observedPriceUsd: 0.0000015, priceProvenance: 'OBSERVED_PRICE'
      }
    ],
    labels
  });

  assert.deepEqual(payload.markers, [
    {
      id: `entry:sol:${ADDRESS}`, side: 'BUY', marketCap: 0, price: 0.0000012,
      label: 'Paper Buy', closeLabel: 'Hide line'
    },
    {
      id: `sell:sol:${ADDRESS}:price-only-sell`, side: 'SELL', marketCap: 0, price: 0.0000015,
      label: 'Paper Sell', closeLabel: 'Hide line'
    }
  ]);
});

test('factual zero-cap BUY price wins over an existing derived position price', () => {
  const payload = buildPayload({
    current: {
      token: { chain: 'sol', address: ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: {
      averageEntryMarketCap: 0, averageEntryPriceUsd: 0.0000099,
      averageEntryPriceProvenance: 'MARKET_CAP_DERIVED', valuationMode: 'MARKET_CAP'
    },
    trades: [{
      id: 'factual-buy', chain: 'sol', tokenAddress: ADDRESS, side: 'BUY',
      marketCapUsd: 0, observedPriceUsd: 0.0000012, priceProvenance: 'OBSERVED_PRICE'
    }],
    labels
  });

  assert.deepEqual(payload.markers, [{
    id: `entry:sol:${ADDRESS}`, side: 'BUY', marketCap: 0, price: 0.0000012,
    label: 'Paper Buy', closeLabel: 'Hide line'
  }]);
});

test('fallback position and first BUY cannot block the next factual BUY entry', () => {
  const position = durableUnknownFallback({
    chain: 'base', tokenAddress: BSC_ADDRESS,
    averageEntryMarketCap: 3_200, averageEntryPriceUsd: 0.0000032,
    averageEntryPriceProvenance: 'SYNTHETIC_PRICE',
    lastPriceProvenance: 'SYNTHETIC_PRICE'
  });
  const factualBuy = {
    id: 'factual-buy', chain: 'base', tokenAddress: BSC_ADDRESS, side: 'BUY',
    marketCapUsd: 8_000, observedPriceUsd: 0.000008,
    priceProvenance: 'OBSERVED_PRICE', quoteSource: 'GMGN_NETWORK'
  };
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: BSC_ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position,
    trades: [durableUnknownFallback({ id: 'fallback-first-buy' }), factualBuy],
    labels
  });

  assert.deepEqual(payload.markers[0], {
    id: `entry:base:${BSC_ADDRESS}`, side: 'BUY', marketCap: 8_000,
    price: 0.000008, label: 'Paper Buy', closeLabel: 'Hide line'
  });
});

test('fallback-only SELLs do not consume the first four usable SELL markers', () => {
  const fallbackSells = [1, 2].map((index) => durableUnknownFallback({
    id: `fallback-sell-${index}`, side: 'SELL', executedAt: 1_000 + index
  }));
  const factualSells = [1, 2, 3, 4, 5].map((index) => ({
    id: `factual-sell-${index}`, chain: 'base', tokenAddress: BSC_ADDRESS,
    side: 'SELL', marketCapUsd: 10_000 + index,
    observedPriceUsd: 0.00001 + index * 0.000001,
    priceProvenance: 'OBSERVED_PRICE', quoteSource: 'GMGN_NETWORK'
  }));
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: BSC_ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: null, trades: [...fallbackSells, ...factualSells], labels
  });

  assert.deepEqual(payload.markers.map((marker) => marker.id), [
    `sell:base:${BSC_ADDRESS}:factual-sell-1`,
    `sell:base:${BSC_ADDRESS}:factual-sell-2`,
    `sell:base:${BSC_ADDRESS}:factual-sell-3`,
    `sell:base:${BSC_ADDRESS}:factual-sell-4`
  ]);
});

test('factual execution prices survive while canonical fallback market caps are removed', () => {
  const buy = durableUnknownFallback({
    id: 'price-buy', quoteSource: 'GMGN_NETWORK', valuationMode: 'PRICE',
    priceProvenance: 'OBSERVED_PRICE', observedPriceUsd: 0.000004,
    syntheticTokenPrice: false, provisional: false,
    quoteObservedAtOriginal: 900
  });
  const sell = { ...buy, id: 'price-sell', side: 'SELL', observedPriceUsd: 0.000005 };
  const trades = [buy, sell];
  const before = structuredClone(trades);
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: BSC_ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: null, trades, labels
  });

  assert.deepEqual(payload.markers.map(({ side, marketCap, price }) => (
    { side, marketCap, price }
  )), [
    { side: 'BUY', marketCap: 0, price: 0.000004 },
    { side: 'SELL', marketCap: 0, price: 0.000005 }
  ]);
  assert.deepEqual(trades, before);
});

test('canonical durable fallback market caps cannot revive without paperFallback', () => {
  for (const side of ['BUY', 'SELL']) {
    for (const [label, paperFallback] of [['missing', undefined], ['false', false]]) {
      const trade = durableUnknownFallback({
        id: `${side.toLowerCase()}-${label}-paper-fallback`, side,
        quoteSource: '', paperFallback
      });
      if (paperFallback === undefined) delete trade.paperFallback;
      const payload = buildPayload({
        current: {
          token: { chain: 'base', address: BSC_ADDRESS },
          quote: {
            priceUsd: 0.002, marketCapUsd: 200_000_000,
            totalSupply: 100_000_000_000, supplySource: 'GMGN_EXACT',
            priceProvenance: 'OBSERVED_PRICE', source: 'GMGN_NETWORK',
            observationId: 'gmgn-live-1', priceObservationId: 'gmgn-live-1',
            marketCapObservationId: 'gmgn-live-1', observedAt: 2_000
          }
        },
        position: null, trades: [trade], labels
      });

      assert.deepEqual(payload.markers, [], `${side}:${label}`);
    }
  }
});

test('source-only canonical fallback prices are rejected for BUY SELL and card records', () => {
  const cases = [
    ['BUY fallback', {
      id: 'source-only-buy', side: 'BUY', quoteSource: 'TANGO_FALLBACK'
    }],
    ['SELL fallback', {
      id: 'source-only-sell', side: 'SELL', source: 'TANGO_FALLBACK'
    }],
    ['BUY card', {
      id: 'source-only-card', side: 'BUY', quoteSource: 'TANGO_FALLBACK_CARD_MARKET_CAP'
    }]
  ];

  for (const [name, source] of cases) {
    const trade = {
      chain: 'base', tokenAddress: BSC_ADDRESS,
      marketCapUsd: 0, observedPriceUsd: 0.000005,
      ...source
    };
    const payload = buildPayload({
      current: {
        token: { chain: 'base', address: BSC_ADDRESS },
        quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
      },
      position: null, trades: [trade], labels
    });

    assert.deepEqual(payload.markers, [], name);
  }
});

test('explicit market-cap fallback signals are removed without suppressing factual prices', () => {
  const base = {
    id: 'mixed-buy', chain: 'base', tokenAddress: BSC_ADDRESS, side: 'BUY',
    marketCapUsd: 5_000, observedPriceUsd: 0.000005,
    priceProvenance: 'OBSERVED_PRICE', quoteSource: 'GMGN_NETWORK'
  };
  const cases = [
    ['market-cap source', { marketCapSource: 'TANGO_FALLBACK' }],
    ['unknown initial valuation', { valuationSource: 'UNKNOWN_INITIAL_MARKET_CAP' }],
    ['launchpad initial valuation', { valuationSource: 'LAUNCHPAD_INITIAL_MARKET_CAP' }],
    ['quote source', { quoteSource: 'TANGO_FALLBACK' }],
    ['generic source', { source: 'TANGO_FALLBACK' }],
    ['coherent synthetic shape', durableUnknownFallback({
      quoteSource: '', marketCapUsd: 5_000, observedPriceUsd: 0.000005
    })]
  ];

  for (const [name, patch] of cases) {
    const trade = { ...base, ...patch };
    if (name === 'coherent synthetic shape') {
      trade.priceProvenance = 'SYNTHETIC_PRICE';
    }
    const payload = buildPayload({
      current: {
        token: { chain: 'base', address: BSC_ADDRESS },
        quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
      },
      position: null, trades: [trade], labels
    });
    if (name === 'coherent synthetic shape' || name === 'quote source') {
      assert.deepEqual(payload.markers, [], name);
    } else {
      assert.equal(payload.markers[0].marketCap, 0, name);
      assert.equal(payload.markers[0].price, 0.000005, name);
    }
  }
});

test('verified card market-cap fallback keeps only its observed market-cap coordinate', () => {
  const card = durableUnknownFallback({
    id: 'verified-card', quoteSource: 'TANGO_FALLBACK_CARD_MARKET_CAP',
    marketCapUsd: 5_000, observedPriceUsd: 0.000005,
    quoteObservedAtOriginal: 900, executedAt: 1_000
  });
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: BSC_ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: null, trades: [card], labels
  });

  assert.deepEqual(payload.markers, [{
    id: `entry:base:${BSC_ADDRESS}`, side: 'BUY', marketCap: 5_000, price: 0,
    label: 'Paper Buy', closeLabel: 'Hide line'
  }]);
});

test('every partial card market-cap fallback signature fails closed', () => {
  const base = {
    id: 'partial-card', chain: 'base', tokenAddress: BSC_ADDRESS, side: 'BUY',
    marketCapUsd: 5_000, observedPriceUsd: 0.000005,
    priceProvenance: 'OBSERVED_PRICE', quoteSource: 'GMGN_NETWORK'
  };
  const partial = [
    ['quote source', { quoteSource: 'TANGO_FALLBACK_CARD_MARKET_CAP' }],
    ['generic source', { source: 'TANGO_FALLBACK_CARD_MARKET_CAP' }],
    ['market-cap source', { marketCapSource: 'TANGO_FALLBACK_CARD_MARKET_CAP' }],
    ['valuation source', { valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY' }]
  ];

  for (const [name, signature] of partial) {
    const payload = buildPayload({
      current: {
        token: { chain: 'base', address: BSC_ADDRESS },
        quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
      },
      position: null, trades: [{ ...base, ...signature }], labels
    });
    assert.equal(payload.markers[0]?.marketCap || 0, 0, name);
  }
});

test('complete card market-cap fallback rejects contradictory explicit provenance', () => {
  const valid = durableUnknownFallback({
    quoteSource: 'TANGO_FALLBACK_CARD_MARKET_CAP', marketCapUsd: 5_000,
    observedPriceUsd: 0.000005, quoteObservedAtOriginal: 900, executedAt: 1_000
  });
  const contradictory = [
    ['generic source', { source: 'TANGO_FALLBACK' }],
    ['market-cap source', { marketCapSource: 'TANGO_FALLBACK' }],
    ['valuation source', { valuationSource: 'UNKNOWN_INITIAL_MARKET_CAP' }]
  ];

  for (const [name, provenance] of contradictory) {
    const payload = buildPayload({
      current: {
        token: { chain: 'base', address: BSC_ADDRESS },
        quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
      },
      position: null, trades: [{ ...valid, ...provenance }], labels
    });
    assert.deepEqual(payload.markers, [], name);
  }
});

test('complete card market-cap fallback accepts coherent explicit transient provenance', () => {
  const card = durableUnknownFallback({
    quoteSource: 'TANGO_FALLBACK_CARD_MARKET_CAP',
    source: 'TANGO_FALLBACK_CARD_MARKET_CAP',
    marketCapSource: 'GMGN_NETWORK',
    valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY',
    marketCapUsd: 5_000, observedPriceUsd: 0.000005,
    quoteObservedAtOriginal: 900, executedAt: 1_000
  });
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: BSC_ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
    },
    position: null, trades: [card], labels
  });

  assert.equal(payload.markers[0].marketCap, 5_000);
  assert.equal(payload.markers[0].price, 0);
});

test('incomplete or forged card market-cap fallback cannot produce a coordinate', () => {
  const valid = durableUnknownFallback({
    quoteSource: 'TANGO_FALLBACK_CARD_MARKET_CAP', marketCapUsd: 5_000,
    observedPriceUsd: 0.000005, quoteObservedAtOriginal: 900, executedAt: 1_000
  });
  const invalid = [
    { ...valid, quoteObservedAtOriginal: 0 },
    { ...valid, quoteObservedAtOriginal: 1_001 },
    { ...valid, observedPriceUsd: 0.01 },
    { ...valid, provisionalSupplyProvenance: '' },
    { ...valid, syntheticTokenPrice: false },
    { ...valid, valuationMode: 'PRICE' }
  ];

  for (const trade of invalid) {
    const payload = buildPayload({
      current: {
        token: { chain: 'base', address: BSC_ADDRESS },
        quote: { priceUsd: 0, marketCapUsd: 0, priceProvenance: 'OBSERVED_PRICE' }
      },
      position: null, trades: [trade], labels
    });
    assert.deepEqual(payload.markers, []);
  }
});

test('legacy unattested records without explicit fallback signatures remain compatible', () => {
  const legacy = {
    id: 'legacy-buy', chain: 'base', tokenAddress: BSC_ADDRESS, side: 'BUY',
    marketCapUsd: 7_000, observedPriceUsd: 0.000007
  };
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: BSC_ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0 }
    },
    position: null, trades: [legacy], labels
  });
  assert.equal(payload.markers[0].marketCap, 7_000);
  assert.equal(payload.markers[0].price, 0.000007);
});

test('factual market-cap coordinates remain when only their price is derived', () => {
  const derivedPrice = {
    id: 'market-cap-buy', chain: 'base', tokenAddress: BSC_ADDRESS, side: 'BUY',
    marketCapUsd: 9_000, observedPriceUsd: 0.000123,
    priceProvenance: 'MARKET_CAP_DERIVED', quoteSource: 'GMGN_NETWORK',
    paperFallback: true, provisional: true, syntheticNativePrice: true,
    syntheticTokenPrice: false, totalSupply: 1_000_000_000,
    supplySource: 'GMGN_EXACT'
  };
  const payload = buildPayload({
    current: {
      token: { chain: 'base', address: BSC_ADDRESS },
      quote: { priceUsd: 0, marketCapUsd: 0 }
    },
    position: null, trades: [derivedPrice], labels
  });
  assert.equal(payload.markers[0].marketCap, 9_000);
  assert.equal(payload.markers[0].price, 0.000009);
});

test('chart cache identity includes chain as well as token address', () => {
  assert.match(chartSource, /markerState\?\.chain !== nextState\?\.chain/);
  assert.match(chartSource, /markerState\?\.tokenAddress !== nextState\?\.tokenAddress/);
});

test('chart bridge accepts the TradingView frame title but ignores unrelated titled frames', () => {
  assert.equal(loadChartBridge({ frameTitle: 'TradingView' }).bridgeInitialized, true);
  assert.equal(loadChartBridge({ frameTitle: 'Unrelated analytics' }).bridgeInitialized, false);
});

test('chart bridge accepts a dynamically titled frame only inside the TradingView container', () => {
  assert.equal(loadChartBridge({
    frameTitle: 'GMGN chart 8/3', frameInTradingView: true
  }).bridgeInitialized, true);
  assert.equal(loadChartBridge({
    frameTitle: 'GMGN chart 8/3', frameInTradingView: false
  }).bridgeInitialized, false);
});

test('actual engine fallback coordinates stay absent after a factual live ratio arrives', () => {
  const baseAddress = '0x1111111111111111111111111111111111111111';
  const token = {
    chain: 'base', address: baseAddress, symbol: 'FALLBACK',
    metadataVerified: true, metadataSource: 'GMGN_NETWORK'
  };
  const settings = State.normalizeSettings({
    slippageBps: 0, platformFeeBps: 0, chains: { base: { networkFeeNative: 0 } }
  });
  const state = State.createInitialState({ now: 1, initialBalances: { base: 10 } });
  state.initialized = true;
  const fallbackValuation = global.Tango.Supply.fallbackValuation({
    chain: 'base', launchpad: ''
  });
  const fallback = {
    ...fallbackValuation,
    chain: 'base', address: baseAddress,
    marketCapDivisor: fallbackValuation.totalSupply,
    provisionalSupply: fallbackValuation.totalSupply,
    nativePriceUsd: 2_000, observedAt: 1_000, nativePriceObservedAt: 1_000,
    source: 'TANGO_FALLBACK', valuationMode: 'MARKET_CAP',
    priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
    syntheticTokenPrice: true, provisional: true, paperFallback: true
  };
  const bought = Engine.executeBuy(state, { token, quote: fallback, amountNative: 1 }, settings, 1_000);
  assert.equal(bought.position.averageEntryPriceProvenance, 'SYNTHETIC_PRICE');
  assert.equal(bought.trade.priceProvenance, 'SYNTHETIC_PRICE');

  const factual = {
    token,
    quote: {
      priceUsd: 0.002, marketCapUsd: 200_000_000,
      totalSupply: 100_000_000_000, supplySource: 'GMGN_EXACT',
      priceProvenance: 'OBSERVED_PRICE', source: 'GMGN_NETWORK',
      observationId: 'gmgn-live-1', priceObservationId: 'gmgn-live-1',
      marketCapObservationId: 'gmgn-live-1', observedAt: 2_000
    }
  };
  const payload = buildPayload({
    current: factual, position: bought.position, trades: bought.state.trades, labels
  });
  assert.equal(payload.currentPrice, 0.002);
  assert.equal(payload.currentMarketCap, 200_000_000);
  assert.deepEqual(payload.markers, []);
});

test('persisted coordinator BUY and SELL keep only independently factual marker dimensions', async () => {
  const scenarios = [
    { name: 'unknown initial valuation', launchpad: '', expected: [] },
    { name: 'verified launchpad initial valuation', launchpad: 'Bankr', expected: [] },
    {
      name: 'observed card market cap', launchpad: '',
      quotePatch: {
        marketCapUsd: 5_000, priceUsd: 0.000005,
        valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY',
        marketCapSource: 'GMGN_TRENCH', marketCapObservedAt: 19_900,
        originalObservedAt: 19_900
      },
      expected: [
        { side: 'BUY', marketCap: 5_000, price: 0 },
        { side: 'SELL', marketCap: 5_000, price: 0 }
      ]
    },
    {
      name: 'observed price with initial market cap', launchpad: '',
      quotePatch: {
        priceUsd: 0.000005, source: 'GMGN_NETWORK', priceSource: 'GMGN_NETWORK',
        priceObservedAt: 19_900, originalObservedAt: 19_900,
        marketCapSource: 'TANGO_FALLBACK', marketCapObservedAt: 0,
        marketCapObservationId: '', valuationMode: 'PRICE',
        valuationSource: 'OBSERVED_PRICE', priceProvenance: 'OBSERVED_PRICE',
        syntheticTokenPrice: false, provisional: false
      },
      expected: [
        { side: 'BUY', marketCap: 0, price: 0.000005 },
        { side: 'SELL', marketCap: 0, price: 0.000005 }
      ]
    }
  ];

  for (const scenario of scenarios) {
    const settings = State.normalizeSettings({
      enabled: true, slippageBps: 0, platformFeeBps: 0,
      chains: { base: { networkFeeNative: 0 } }
    });
    const initial = State.createInitialState({ now: 1, initialBalances: { base: 10 } });
    initial.initialized = true;
    const values = {
      [global.Tango.STORAGE_KEY]: structuredClone(initial),
      [global.Tango.SETTINGS_KEY]: structuredClone(settings)
    };
    let executionNow = 20_000;
    const coordinator = StateCoordinator.create({
      async readRaw(keys) {
        return Object.fromEntries(keys.filter((key) => key in values)
          .map((key) => [key, structuredClone(values[key])]));
      },
      async writeRaw(next) { Object.assign(values, structuredClone(next)); },
      now: () => executionNow
    });
    const token = {
      chain: 'base', address: BSC_ADDRESS, symbol: 'MARKER_TEST',
      launchpad: scenario.launchpad, metadataVerified: true, metadataSource: 'GMGN_TRENCH'
    };
    const fallback = global.Tango.Supply.fallbackValuation(token);
    const quote = {
      ...fallback, chain: 'base', address: BSC_ADDRESS,
      marketCapDivisor: fallback.totalSupply,
      provisionalSupply: fallback.supplySource === 'UNKNOWN_FALLBACK' ? fallback.totalSupply : 0,
      nativePriceUsd: 2_000, nativePriceObservedAt: 20_000, observedAt: 20_000,
      source: 'TANGO_FALLBACK', valuationMode: 'MARKET_CAP',
      priceProvenance: 'FALLBACK_INITIAL_MARKET_CAP',
      syntheticTokenPrice: true, provisional: true, paperFallback: true,
      ...scenario.quotePatch
    };
    await coordinator.mutate(structuredClone({
      type: 'EXECUTE_BUY', order: { token, quote, amountNative: 1 }
    }));
    executionNow += 1;
    await coordinator.mutate(structuredClone({
      type: 'EXECUTE_SELL', order: { token, quote, percent: 50 }
    }));
    const persisted = await coordinator.getAll();
    const roundTrip = State.normalizeState(structuredClone(persisted.state), settings, { strict: true });
    const payload = buildPayload({
      current: { token, quote: { priceUsd: 0, marketCapUsd: 0 } },
      position: roundTrip.positions[Engine.positionKey('base', BSC_ADDRESS)],
      trades: roundTrip.trades, labels
    });
    assert.deepEqual(payload.markers.map(({ side, marketCap, price }) => ({
      side, marketCap, price
    })), scenario.expected, scenario.name);
  }
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
    frameContext: { axisHint: 'UNKNOWN', frameGeneration: 1, probeId: 'test:1' },
    observedProbe: { probeId: 'test:1', frameGeneration: 1 },
    markerPositions: [],
    markerEconomicCoordinateCount: 0,
    overlayChildren: 0,
    overlayTops: [],
    overlayStyles: [],
    diagnostic: { reason: 'IDLE', axisHint: 'UNKNOWN', frameGeneration: 0 }
  });
});

test('card market-cap entry uses the verified position average across buys and partial sells', () => {
  const token = { chain: 'base', address: BSC_ADDRESS, symbol: 'CARD', metadataVerified: true,
    metadataSource: 'GMGN_TRENCH' };
  const settings = State.normalizeSettings({ slippageBps: 0, platformFeeBps: 0,
    chains: { base: { networkFeeNative: 0 } } });
  const quote = (marketCapUsd, now) => ({ ...global.Tango.Supply.fallbackValuation(token),
    chain: 'base', address: token.address, marketCapUsd, priceUsd: marketCapUsd / 1e9,
    marketCapDivisor: 1e9, provisionalSupply: 1e9, nativePriceUsd: 2000,
    nativePriceObservedAt: now, observedAt: now, originalObservedAt: now - 1,
    source: 'TANGO_FALLBACK_CARD_MARKET_CAP', valuationSource: 'CARD_MARKET_CAP_FALLBACK_SUPPLY',
    marketCapSource: 'GMGN_TRENCH', marketCapObservedAt: now - 1,
    valuationMode: 'MARKET_CAP', priceProvenance: 'SYNTHETIC_PRICE',
    syntheticTokenPrice: true, provisional: true, paperFallback: true });
  const initial = State.createInitialState({ now: 1, initialBalances: { base: 10 } });
  initial.initialized = true;
  const first = Engine.executeBuy(initial, { token, quote: quote(5000, 10000), amountNative: 1 }, settings, 10000);
  const second = Engine.executeBuy(first.state, { token, quote: quote(10000, 11000), amountNative: 1 }, settings, 11000);
  const sold = Engine.executeSell(second.state, { token, quote: quote(12000, 12000), percent: 50 }, settings, 12000);
  for (const result of [second, sold]) {
    const state = State.normalizeState(result.state, settings, { strict: true });
    const position = state.positions[Engine.positionKey('base', BSC_ADDRESS)];
    const payload = buildPayload({ current: { token, quote: {} }, position, trades: state.trades, labels });
    assert.equal(payload.markers.find(marker => marker.side === 'BUY').marketCap, 7500);
    assert.equal(payload.markers.find(marker => marker.side === 'BUY').price, 0);
  }
  const incomplete = buildPayload({ current: { token, quote: {} }, position: second.position,
    trades: [second.trade], labels });
  assert.equal(incomplete.markers.filter(marker => marker.side === 'BUY').length, 0,
    'a missing origin must not substitute the most recent fill for the average');
  for (const field of ['quantity', 'costBasisNative', 'averageEntryMarketCap']) {
    const altered = buildPayload({ current: { token, quote: {} },
      position: { ...second.position, [field]: second.position[field] * 1.1 }, trades: second.state.trades, labels });
    assert.equal(altered.markers.filter(marker => marker.side === 'BUY').length, 0, field);
  }
  for (const times of [[10000, 11000, 12000], [10000, 10000, 10000]]) {
    const opened = Engine.executeBuy(initial, { token, quote: quote(5000, times[0]), amountNative: 1 }, settings, times[0]);
    const partial = Engine.executeSell(opened.state, { token, quote: quote(8000, times[1]), percent: 50 }, settings, times[1]);
    const added = Engine.executeBuy(partial.state, { token, quote: quote(10000, times[2]), amountNative: 1 }, settings, times[2]);
    const payload = buildPayload({ current: { token, quote: {} }, position: added.position, trades: added.state.trades, labels });
    assert.ok(Math.abs(payload.markers.find(marker => marker.side === 'BUY').marketCap - 8333.333333333333) < 1e-7);
    const missingSell = buildPayload({ current: { token, quote: {} }, position: added.position,
      trades: added.state.trades.filter(trade => trade.side !== 'SELL'), labels });
    assert.equal(missingSell.markers.filter(marker => marker.side === 'BUY').length, 0);
    const mixed = buildPayload({ current: { token, quote: {} }, position: added.position,
      trades: added.state.trades.map(trade => trade.id === opened.trade.id
        ? { ...trade, quoteSource: 'TANGO_FALLBACK', marketCapUsd: 3200 } : trade), labels });
    assert.equal(mixed.markers.filter(marker => marker.side === 'BUY').length, 0);
  }
});

test('first identified marker reuses current axis labels captured after an unidentified clear', () => {
  const chart = loadChartBridge();
  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: { markers: [] } });
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().overlayChildren, 1);
});

test('latest axis generation remains eligible 1.5 seconds after labels precede the first marker', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5K', 400], ['$6K', 300], ['$7K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.clock.now += 1_501;
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);
});

test('axis fitting unions latest-generation labels with fresh older-generation labels', () => {
  const chart = loadChartBridge();
  chart.api.seedAxisRecords(chart.canvasContext, [
    { text: '$5K', y: 400, generation: 2, updatedAt: chart.clock.now - 1_501 },
    { text: '$6K', y: 300, generation: 2, updatedAt: chart.clock.now - 1_501 },
    { text: '$7K', y: 200, generation: 1, updatedAt: chart.clock.now }
  ]);

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().overlayChildren, 1);
});

test('same-token marker keeps its verified scale while the chart axis is idle', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  const initialTop = chart.api.snapshot().overlayTops[0];
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.clock.now += 1_501;
  chart.api.render();

  assert.ok(initialTop);
  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], initialTop);
});

function tiedAxisPayload() {
  return {
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 2,
    currentMarketCap: 2_000,
    markers: [{
      id: 'buy',
      side: 'BUY',
      marketCap: 2_000,
      price: 2,
      label: 'Paper Buy'
    }]
  };
}

test('MARKET_CAP hint resolves an exact PRICE MCAP tie in favor of market cap', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }

  chart.markers(tiedAxisPayload(), {
    axisHint: 'MARKET_CAP',
    frameGeneration: 1,
    probeId: 'test:1'
  });

  assert.equal(chart.api.snapshot().stableScale.type, 'MARKET_CAP');
  assert.equal(chart.api.snapshot().stableScale.factor, 1_000);
});

test('PRICE hint resolves an exact PRICE MCAP tie in favor of price', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }

  chart.markers(tiedAxisPayload(), {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });

  assert.equal(chart.api.snapshot().stableScale.type, 'PRICE');
  assert.equal(chart.api.snapshot().stableScale.factor, 1);
});

test('new frame context rejects old anchors and an older generation cannot restore them', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.markers(tiedAxisPayload(), {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.markers(tiedAxisPayload(), {
    axisHint: 'MARKET_CAP',
    frameGeneration: 2,
    probeId: 'test:2'
  });
  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  chart.markers(tiedAxisPayload(), {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().frameContext.frameGeneration, 2);
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  for (const [text, y] of [['$1', 420], ['$2', 320], ['$3', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();
  assert.equal(chart.api.snapshot().stableScale.type, 'MARKET_CAP');
  assert.equal(chart.api.snapshot().overlayChildren, 1);
});

test('same-generation axis hint change requires anchors observed after the change', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.markers(tiedAxisPayload(), {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().stableScale.type, 'PRICE');

  chart.markers(tiedAxisPayload(), {
    axisHint: 'MARKET_CAP',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  for (const [text, y] of [['$1', 420], ['$2', 320], ['$3', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();
  assert.equal(chart.api.snapshot().stableScale.type, 'MARKET_CAP');
  assert.equal(chart.api.snapshot().overlayChildren, 1);
});

test('malformed frame context cannot replace or clear current chart state', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.markers(tiedAxisPayload(), {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  const before = JSON.parse(JSON.stringify(chart.api.snapshot()));

  chart.rawMessage({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_MARKERS',
    context: {
      axisHint: 'MARKET_CAP',
      frameGeneration: '2',
      probeId: 'test:2'
    },
    payload: { markers: [] }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), before);
});

test('an unissued high-generation marker context cannot poison a legal lower-generation clear', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const issuedContext = {
    axisHint: 'PRICE', frameGeneration: 1, probeId: 'issued:1'
  };
  chart.markers(tiedAxisPayload(), issuedContext);
  const before = JSON.parse(JSON.stringify(chart.api.snapshot()));

  chart.rawMessage({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_MARKERS',
    context: {
      axisHint: 'MARKET_CAP', frameGeneration: 99, probeId: 'never-issued:99'
    },
    payload: tiedAxisPayload()
  });

  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), before);

  chart.rawMessage({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_MARKERS',
    context: issuedContext,
    payload: { markers: [] }
  });
  const cleared = chart.api.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(cleared.markerState)), { markers: [] });
  assert.equal(cleared.overlayChildren, 0);
  assert.equal(cleared.frameContext.frameGeneration, 1);
});

test('a delayed same-generation old-probe replay is inert after a newly observed probe', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const oldContext = {
    axisHint: 'PRICE', frameGeneration: 1, probeId: 'issued:old'
  };
  const newContext = {
    axisHint: 'MARKET_CAP', frameGeneration: 1, probeId: 'issued:new'
  };
  chart.markers(tiedAxisPayload(), oldContext);
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.probe(newContext);
  const afterNewProbe = JSON.parse(JSON.stringify(chart.api.snapshot()));
  assert.equal(afterNewProbe.observedProbe.probeId, newContext.probeId);
  assert.equal(afterNewProbe.frameContext, null);
  assert.equal(afterNewProbe.stableScale, null);
  assert.equal(afterNewProbe.overlayChildren, 0);

  chart.probe(newContext);
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), afterNewProbe);

  for (const [text, y] of [['$1', 420], ['$2', 320], ['$3', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), afterNewProbe);

  chart.rawMessage({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_MARKERS',
    context: oldContext,
    payload: tiedAxisPayload()
  });
  assert.deepEqual(JSON.parse(JSON.stringify(chart.api.snapshot())), afterNewProbe);

  chart.rawMessage({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_MARKERS',
    context: newContext,
    payload: tiedAxisPayload()
  });
  const recovered = chart.api.snapshot();
  assert.equal(recovered.frameContext.probeId, newContext.probeId);
  assert.equal(recovered.stableScale.type, 'MARKET_CAP');
  assert.equal(recovered.overlayChildren, 1);

  chart.rawMessage({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_MARKERS',
    context: newContext,
    payload: { markers: [] }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('same marker id follows a changed economic value below the jitter deadband', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');

  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2.02, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2.02, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '298px');
});

test('unchanged economics and plot bounds retain the visual deadband for a two pixel fit jitter', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const payload = {
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 1.5,
    currentMarketCap: 0,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 1.5, label: 'Paper Buy' }]
  };
  chart.markers(payload, {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  const firstTop = chart.api.snapshot().overlayTops[0];

  for (const [text, y] of [['$1', 400], ['$2', 302], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], firstTop);
});

test('a one pixel anchor change removes a marker when the newest fit crosses the plot boundary', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const payload = {
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 4,
    currentMarketCap: 0,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 4, label: 'Paper Buy' }]
  };
  chart.markers(payload, {
    axisHint: 'PRICE', frameGeneration: 1, probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '100px');

  chart.api.record(chart.canvasContext, '$2', 950, 299);
  chart.api.render();

  const snapshot = chart.api.snapshot();
  assert.equal(snapshot.stableScale.fit.intercept < 500, true);
  assert.equal(snapshot.overlayChildren, 0);
  assert.equal(snapshot.diagnostic.reason, 'OUT_OF_PLOT');
});

test('economic cache prunes a removed marker before that id reappears', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');

  for (const [text, y] of [['$1', 398], ['$2', 298], ['$3', 198]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'other', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().markerEconomicCoordinateCount, 1);
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().overlayTops[0], '298px');
});

test('economic cache clears when the token identity changes', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');

  chart.setHref(`https://gmgn.ai/bsc/token/${BSC_OTHER_ADDRESS}`);
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_OTHER_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().markerEconomicCoordinateCount, 0);
  for (const [text, y] of [['$1', 398], ['$2', 298], ['$3', 198]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], '298px');
});

test('economic cache clears across a resize before the same marker rerenders', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');

  chart.resize();
  assert.equal(chart.api.snapshot().markerEconomicCoordinateCount, 0);
  for (const [text, y] of [['$1', 398], ['$2', 298], ['$3', 198]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], '298px');
});

test('economic cache distinguishes price and market-cap axes with the same raw coordinate', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 2, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');

  for (const [text, y] of [['$1', 398], ['$2', 298], ['$3', 198]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 0, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 2, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().overlayTops[0], '298px');
});

test('economic cache distinguishes market-cap factors with the same raw coordinate', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 0, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 2, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');

  for (const [text, y] of [['$1', 398], ['$2', 298], ['$3', 198]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentPrice: 0, currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 2_000, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().overlayTops[0], '298px');
});

test('clearing an unrelated canvas preserves the active price-axis scale', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.ok(chart.api.snapshot().stableScale);

  const unrelatedContext = chart.createCanvasContext();
  unrelatedContext.clearRect(0, 0, unrelatedContext.canvas.width, unrelatedContext.canvas.height);

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
});

test('positive marker values select an axis when both current references are zero', () => {
  const priceChart = loadChartBridge({
    href: `https://gmgn.ai/sol/token/${ADDRESS}`
  });
  for (const [text, y] of [['$0.0000010', 400], ['$0.0000012', 300], ['$0.0000014', 200]]) {
    priceChart.api.record(priceChart.canvasContext, text, 950, y);
  }
  priceChart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'sol', tokenAddress: ADDRESS, currentMarketCap: 0, currentPrice: 0,
      markers: [{ id: 'price-buy', side: 'BUY', marketCap: 0, price: 0.0000012, label: 'Paper Buy' }]
    }
  });

  const marketCapChart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    marketCapChart.api.record(marketCapChart.canvasContext, text, 950, y);
  }
  marketCapChart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 0, currentPrice: 0,
      markers: [{ id: 'cap-buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(priceChart.api.snapshot().overlayChildren, 1, 'marker factual price selects a price axis');
  assert.equal(marketCapChart.api.snapshot().overlayChildren, 1, 'marker market cap selects a market-cap axis');
});

test('current right-axis labels place a $6.028K marker near the $6.02K scale', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1K', 650], ['$2K', 600], ['$3K', 550]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.clock.now += 1_501;
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  const top = Number.parseInt(chart.api.snapshot().overlayTops[0], 10);
  assert.ok(top >= 270 && top <= 300, `expected current-scale y near 286, got ${top}`);
});

test('a factual marker appears only while its projection is inside current plot bounds', () => {
  const chart = loadChartBridge({
    canvasRect: { left: 20, top: 180, width: 1_000, height: 420 },
    viewport: { width: 1_200, height: 800 }
  });
  chart.api.seedAxisRecords(chart.canvasContext, [
    { text: '$1', y: 400, generation: 0, updatedAt: chart.clock.now },
    { text: '$2', y: 300, generation: 0, updatedAt: chart.clock.now },
    { text: '$3', y: 200, generation: 0, updatedAt: chart.clock.now }
  ]);
  const payload = {
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 3.5,
    currentMarketCap: 0,
    markers: [{
      id: 'buy',
      side: 'BUY',
      marketCap: 0,
      price: 3.5,
      label: 'Paper Buy'
    }]
  };

  chart.markers(payload, {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  chart.canvasContext.clearRect(900, 0, 100, 700);
  chart.api.seedAxisRecords(chart.canvasContext, [
    { text: '$3', y: 400, generation: 1, updatedAt: chart.clock.now + 1 },
    { text: '$4', y: 300, generation: 1, updatedAt: chart.clock.now + 1 },
    { text: '$5', y: 200, generation: 1, updatedAt: chart.clock.now + 1 }
  ]);
  chart.api.render();
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '350px');

  chart.canvasContext.clearRect(900, 0, 100, 700);
  chart.api.seedAxisRecords(chart.canvasContext, [
    { text: '$1', y: 400, generation: 2, updatedAt: chart.clock.now + 2 },
    { text: '$2', y: 300, generation: 2, updatedAt: chart.clock.now + 2 },
    { text: '$3', y: 200, generation: 2, updatedAt: chart.clock.now + 2 }
  ]);
  chart.api.render();
  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('a PRICE marker missing its factual coordinate cannot be synthesized from the current ratio', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  const frameContext = {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  };

  chart.markers({
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 2,
    currentMarketCap: 2_000,
    markers: [{ id: 'missing', side: 'BUY', marketCap: 2_000, price: 0, label: 'Paper Buy' }]
  }, frameContext);
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  chart.markers({
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 2,
    currentMarketCap: 2_000,
    markers: [{ id: 'canonical', side: 'BUY', marketCap: 2_000, price: 2, label: 'Paper Buy' }]
  }, frameContext);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');
});

test('line top left and right come from one transformed current source rectangle', () => {
  const chart = loadChartBridge({
    canvasRect: { left: 20, top: 40, width: 1_000, height: 350 },
    viewport: { width: 1_000, height: 800 }
  });
  chart.canvasContext.setTransform(1, 0, 0, 2, 0, 0);
  for (const [text, y] of [['$1', 300], ['$2', 200], ['$3', 100]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }

  chart.markers({
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 2,
    currentMarketCap: 0,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
  }, {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });

  const snapshot = chart.api.snapshot();
  assert.equal(snapshot.overlayTops[0], '240px');
  assert.equal(snapshot.overlayStyles[0].left, '20px');
  assert.equal(snapshot.overlayStyles[0].right, '30px');
});

test('a moved source rectangle hides the old scale until fresh anchors arrive', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.markers({
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 2,
    currentMarketCap: 0,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
  }, {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.setCanvasRect({ top: 24 });
  chart.api.render();

  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('a backing-store resize with an unchanged CSS rectangle requires fresh anchors', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.markers({
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 2,
    currentMarketCap: 0,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
  }, {
    axisHint: 'PRICE',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.canvasContext.canvas.width = 2_000;
  chart.api.render();
  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
    chart.api.record(chart.canvasContext, text, 1_900, y);
  }
  chart.api.render();
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '300px');
});

test('token switch rejects still-fresh axis labels captured for the previous token', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'old-buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.clock.now += 100;
  chart.setHref(`https://gmgn.ai/bsc/token/${BSC_OTHER_ADDRESS}`);
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_OTHER_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'new-buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('identified token followed by an empty clear cannot lend its labels to the next token', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'old-buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.message({ source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS', payload: { markers: [] } });
  chart.setHref(`https://gmgn.ai/bsc/token/${BSC_OTHER_ADDRESS}`);
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_OTHER_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'new-buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('resize boundary cannot rebuild a scale from pre-resize labels plus two new labels', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.resize();
  for (const [text, y] of [['$5.9K', 350], ['$6.1K', 250]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('full-canvas clear with no new labels cannot rebuild the old overlay', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.clear();
  chart.api.render();

  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('an active qualifying clear removes the overlay before the next repair tick', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  chart.canvasContext.clearRect(900, 0, 100, 700);
  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);

  for (const [text, y] of [['$5.9K', 420], ['$6.1K', 320], ['$6.3K', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '356px');
});

test('newest complete axis snapshot after a narrow right-axis clear', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');

  chart.clock.now += 400;
  chart.canvasContext.clearRect(900, 0, 100, 700);
  for (const [text, y] of [['$5.9K', 420], ['$6.1K', 320], ['$6.3K', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], '356px');
});

test('a tall clear entirely right of the canvas cannot invalidate the active axis snapshot', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.clearRect(1001, 0, 1, 700);
  chart.api.render();

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');
});

test('a tall clear below the canvas cannot invalidate the active axis snapshot', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.clearRect(900, 701, 100, 700);
  chart.api.render();

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');
});

test('the right-axis boundary accepts exactly 70 percent clipped coverage at the 80 percent edge', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.clock.now += 400;
  chart.canvasContext.clearRect(700, 210, 100, 700);
  for (const [text, y] of [['$5.9K', 420], ['$6.1K', 320], ['$6.3K', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], '356px');
});

test('a scaled raw qualifier that misses the backing right axis preserves the active overlay', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.setTransform(0.5, 0, 0, 0.5, 0, 0);
  chart.canvasContext.clearRect(900, 0, 100, 700);
  chart.api.render();

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');
});

test('a scaled raw non-qualifier that covers the backing right axis starts a fresh snapshot', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.clock.now += 400;
  chart.canvasContext.setTransform(2, 0, 0, 2, 0, 0);
  chart.canvasContext.clearRect(400, 0, 100, 350);
  chart.canvasContext.setTransform(1, 0, 0, 1, 0, 0);
  for (const [text, y] of [['$5.9K', 420], ['$6.1K', 320], ['$6.3K', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], '356px');
});

test('a translated raw qualifier that misses the backing right axis preserves the active overlay', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.setTransform(1, 0, 0, 1, -250, 0);
  chart.canvasContext.clearRect(900, 0, 100, 700);
  chart.api.render();

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');
});

test('a translated raw non-qualifier that covers the backing right axis starts a fresh snapshot', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.clock.now += 400;
  chart.canvasContext.setTransform(1, 0, 0, 1, 250, 0);
  chart.canvasContext.clearRect(650, 0, 100, 700);
  chart.canvasContext.setTransform(1, 0, 0, 1, 0, 0);
  for (const [text, y] of [['$5.9K', 420], ['$6.1K', 320], ['$6.3K', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], '356px');
});

test('a skewed right-axis clear is ignored conservatively by the narrow branch', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.setTransform(1, 0.1, 0, 1, 0, 0);
  chart.canvasContext.clearRect(900, 0, 100, 700);
  chart.api.render();

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');
});

test('an axis-aligned reflected clear that covers the backing right axis starts a fresh snapshot', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.clock.now += 400;
  chart.canvasContext.setTransform(-1, 0, 0, -1, 1_000, 700);
  chart.canvasContext.clearRect(0, 0, 100, 700);
  chart.canvasContext.setTransform(1, 0, 0, 1, 0, 0);
  for (const [text, y] of [['$5.9K', 420], ['$6.1K', 320], ['$6.3K', 220]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayTops[0], '356px');
});

test('a failed transform read cannot trigger the narrow right-axis branch', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.getTransform = () => { throw new Error('transform unavailable'); };
  chart.canvasContext.clearRect(900, 0, 100, 700);
  chart.api.render();

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');
});

test('a malformed transform cannot trigger the narrow right-axis branch', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0 });
  chart.canvasContext.clearRect(900, 0, 100, 700);
  chart.api.render();

  assert.ok(chart.api.snapshot().stableScale);
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().overlayTops[0], '286px');
});

test('failed or malformed transform conversion cannot contribute axis anchors', () => {
  const cases = [
    ['throwing transform read', () => { throw new Error('transform unavailable'); }],
    ['missing transformPoint', () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })],
    ['non-finite transformed point', () => ({
      a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
      transformPoint: () => ({ x: Number.NaN, y: 300 })
    })]
  ];

  for (const [name, getTransform] of cases) {
    const chart = loadChartBridge();
    chart.canvasContext.getTransform = getTransform;
    for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    chart.markers({
      chain: 'bsc',
      tokenAddress: BSC_ADDRESS,
      currentPrice: 2,
      currentMarketCap: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 2, label: 'Paper Buy' }]
    }, {
      axisHint: 'PRICE',
      frameGeneration: 1,
      probeId: 'test:1'
    });

    assert.equal(chart.api.snapshot().stableScale, null, name);
    assert.equal(chart.api.snapshot().overlayChildren, 0, name);
  }
});

test('the legacy full-canvas clear remains effective when reading the transform fails', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });

  chart.canvasContext.getTransform = () => { throw new Error('transform unavailable'); };
  chart.clear();
  chart.api.render();

  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.snapshot().overlayChildren, 0);
});

test('replacing the active canvas without a full clear discards its old axis records', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);

  const replacedCanvas = chart.canvasContext.canvas;
  replacedCanvas.isConnected = false;
  chart.canvasContext.canvas = {
    isConnected: true, width: 1_000, height: 700,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1_200, height: 700 })
  };
  chart.api.render();

  assert.equal(chart.api.snapshot().overlayChildren, 0, 'disconnected canvas records cannot select an axis');
  assert.equal(chart.api.trackedCanvasCount(), 0, 'disconnected canvas history is discarded');
});

test('MCAP hint with zero text anchors stays hidden with bounded diagnostics', () => {
  const chart = loadChartBridge();
  chart.markers({
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 0,
    currentMarketCap: 6_000,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
  }, {
    axisHint: 'MARKET_CAP',
    frameGeneration: 1,
    probeId: 'test:1'
  });

  const snapshot = chart.api.snapshot();
  assert.equal(snapshot.overlayChildren, 0);
  assert.deepEqual(Object.keys(snapshot.diagnostic).sort(), [
    'axisHint', 'frameGeneration', 'reason'
  ]);
  assert.deepEqual(snapshot.diagnostic, {
    reason: 'NO_TEXT_CALLS',
    axisHint: 'MARKET_CAP',
    frameGeneration: 1
  });
  assert.equal(JSON.stringify(snapshot.diagnostic).includes(BSC_ADDRESS), false);
});

test('a dynamically observed worker handoff clears the current scale and never invents a coordinate', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5K', 400], ['$6K', 300], ['$7K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.markers({
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 0,
    currentMarketCap: 6_000,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 6_000, price: 0, label: 'Paper Buy' }]
  }, {
    axisHint: 'MARKET_CAP',
    frameGeneration: 1,
    probeId: 'test:1'
  });
  assert.equal(chart.api.snapshot().overlayChildren, 1);
  assert.equal(chart.api.snapshot().diagnostic.reason, 'RENDERED');

  const workerContext = chart.createCanvasContext();
  workerContext.canvas.transferControlToOffscreen();
  chart.api.render();

  const snapshot = chart.api.snapshot();
  assert.equal(snapshot.stableScale, null);
  assert.equal(snapshot.overlayChildren, 0);
  assert.equal(snapshot.diagnostic.reason, 'WORKER_ONLY');
});

test('out-of-plot source disconnect and viewport changes have distinct diagnostics', async (t) => {
  const payload = {
    chain: 'bsc',
    tokenAddress: BSC_ADDRESS,
    currentPrice: 3.5,
    currentMarketCap: 0,
    markers: [{ id: 'buy', side: 'BUY', marketCap: 0, price: 3.5, label: 'Paper Buy' }]
  };
  const frameContext = {
    axisHint: 'PRICE', frameGeneration: 1, probeId: 'test:1'
  };

  await t.test('out of plot', () => {
    const chart = loadChartBridge({
      canvasRect: { left: 20, top: 180, width: 1_000, height: 420 }
    });
    chart.api.seedAxisRecords(chart.canvasContext, [
      { text: '$1', y: 400, generation: 0, updatedAt: chart.clock.now },
      { text: '$2', y: 300, generation: 0, updatedAt: chart.clock.now },
      { text: '$3', y: 200, generation: 0, updatedAt: chart.clock.now }
    ]);
    chart.markers(payload, frameContext);
    assert.equal(chart.api.snapshot().diagnostic.reason, 'OUT_OF_PLOT');
  });

  await t.test('source disconnected', () => {
    const chart = loadChartBridge();
    for (const [text, y] of [['$2', 400], ['$3', 300], ['$4', 200]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    chart.markers(payload, frameContext);
    chart.canvasContext.canvas.isConnected = false;
    chart.api.render();
    assert.equal(chart.api.snapshot().diagnostic.reason, 'SOURCE_DISCONNECTED');
  });

  await t.test('viewport changed', () => {
    const chart = loadChartBridge();
    for (const [text, y] of [['$2', 400], ['$3', 300], ['$4', 200]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    chart.markers(payload, frameContext);
    chart.setCanvasRect({ top: 24 });
    chart.api.render();
    assert.equal(chart.api.snapshot().diagnostic.reason, 'VIEWPORT_CHANGED');
  });
});

test('scale diagnostics distinguish nonnumeric sparse stale fit and mode failures', async (t) => {
  await t.test('nonnumeric text', () => {
    const chart = loadChartBridge();
    chart.canvasContext.fillText('Volume', 950, 300);
    chart.markers(tiedAxisPayload(), {
      axisHint: 'PRICE', frameGeneration: 1, probeId: 'test:1'
    });
    assert.equal(chart.api.snapshot().diagnostic.reason, 'NO_NUMERIC_LABELS');
  });

  await t.test('two unique anchors', () => {
    const chart = loadChartBridge();
    chart.api.record(chart.canvasContext, '$1', 950, 400);
    chart.api.record(chart.canvasContext, '$2', 950, 300);
    chart.markers(tiedAxisPayload(), {
      axisHint: 'PRICE', frameGeneration: 1, probeId: 'test:1'
    });
    assert.equal(chart.api.snapshot().diagnostic.reason, 'TOO_FEW_ANCHORS');
  });

  await t.test('stale generation', () => {
    const chart = loadChartBridge();
    for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    chart.markers(tiedAxisPayload(), {
      axisHint: 'PRICE', frameGeneration: 1, probeId: 'test:1'
    });
    chart.markers(tiedAxisPayload(), {
      axisHint: 'PRICE', frameGeneration: 2, probeId: 'test:2'
    });
    assert.equal(chart.api.snapshot().diagnostic.reason, 'STALE_GENERATION');
  });

  await t.test('positive-slope fit', () => {
    const chart = loadChartBridge();
    for (const [text, y] of [['$1', 200], ['$2', 300], ['$3', 400]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    chart.markers(tiedAxisPayload(), {
      axisHint: 'PRICE', frameGeneration: 1, probeId: 'test:1'
    });
    assert.equal(chart.api.snapshot().diagnostic.reason, 'REJECTED_FIT');
  });

  await t.test('explicit dimension without factual value', () => {
    const chart = loadChartBridge();
    for (const [text, y] of [['$1', 400], ['$2', 300], ['$3', 200]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    chart.markers({
      chain: 'bsc',
      tokenAddress: BSC_ADDRESS,
      currentPrice: 0,
      currentMarketCap: 2_000,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 2_000, price: 0, label: 'Paper Buy' }]
    }, {
      axisHint: 'PRICE', frameGeneration: 1, probeId: 'test:1'
    });
    assert.equal(chart.api.snapshot().diagnostic.reason, 'REJECTED_MODE');
  });
});

test('markerless renders discard repeatedly disconnected canvas histories but retain connected records', () => {
  const chart = loadChartBridge();
  const retainedContext = chart.createCanvasContext();
  for (const [text, y] of [['$8K', 400], ['$9K', 300], ['$10K', 200]]) {
    chart.api.record(retainedContext, text, 950, y);
  }

  for (let replacement = 0; replacement < 3; replacement += 1) {
    for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
      chart.api.record(chart.canvasContext, text, 950, y);
    }
    const replacedCanvas = chart.canvasContext.canvas;
    replacedCanvas.isConnected = false;
    chart.canvasContext.canvas = {
      isConnected: true, width: 1_000, height: 700,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1_200, height: 700 })
    };

    chart.api.render();
    assert.equal(chart.api.trackedCanvasCount(), 1, 'only the connected canvas history remains');
  }
});

test('all-hidden markers discard a disconnected active canvas and its stable scale', () => {
  const chart = loadChartBridge();
  for (const [text, y] of [['$5.8K', 400], ['$6K', 300], ['$6.2K', 200]]) {
    chart.api.record(chart.canvasContext, text, 950, y);
  }
  chart.message({
    source: 'TANGO_PAPER_PARENT', type: 'CHART_MARKERS',
    payload: {
      chain: 'bsc', tokenAddress: BSC_ADDRESS, currentMarketCap: 6_028, currentPrice: 0,
      markers: [{ id: 'buy', side: 'BUY', marketCap: 6_028, price: 0, label: 'Paper Buy' }]
    }
  });
  assert.ok(chart.api.snapshot().stableScale);

  chart.api.hideMarker('buy');
  chart.canvasContext.canvas.isConnected = false;
  chart.api.render();

  assert.equal(chart.api.snapshot().stableScale, null);
  assert.equal(chart.api.trackedCanvasCount(), 0);
});
