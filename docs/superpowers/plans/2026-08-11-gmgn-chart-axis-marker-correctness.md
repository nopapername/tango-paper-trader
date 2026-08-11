# GMGN Chart Axis Marker Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each GMGN BUY/SELL chart line to the current chart frame's sanitized axis type, document generation, authoritative Canvas scale, and current plot bounds so a line is shown only at its factual in-plot coordinate.

**Architecture:** The parent content runtime keeps the canonical token-scoped marker payload unchanged and attaches a per-delivery frame context envelope containing only a sanitized axis enum, a monotonic frame generation, and the correlated READY probe ID. The chart child validates that context, constrains the existing robust Canvas fit to the indicated economic dimension, records source geometry with every accepted scale, and fails closed with bounded in-memory diagnostics when a current numeric mapping is unavailable.

**Tech Stack:** Chrome MV3 content scripts, plain JavaScript, Canvas 2D instrumentation, `window.postMessage`, Node.js `node:test`, and VM-based DOM/Canvas fixtures.

## Global Constraints

- Never click, reveal, forward to, or activate a GMGN native trading control.
- Do not add wallet, signature, approval, swap, RPC, real-funds, network, host-permission, or `unlimitedStorage` capabilities.
- Keep `Tango.Markers.buildPayload()` and `src/content/markers.js` unchanged unless a newly written RED demonstrates a separate factual-coordinate defect; the currently approved work changes transport and projection only.
- Keep the canonical marker payload token-scoped and free of `axisHint`, frame generation, READY correlation, widget options, source geometry, and diagnostics.
- The only axis hint values crossing the parent/child bridge are `MARKET_CAP`, `PRICE`, and `UNKNOWN`; raw `data-widget-options` never crosses the bridge.
- A chart line is rendered only when at least three current numeric anchors produce a trustworthy mapping and its factual coordinate projects inside the current plot bounds.
- Never clamp a chart line to the top or bottom and never add an out-of-range substitute indicator.
- `MARKET_CAP` excludes PRICE candidates, `PRICE` excludes MARKET_CAP candidates, and `UNKNOWN` preserves the existing scored fallback.
- A mode hint, iframe bounds, current token value, or worker configuration without numeric anchors never authorizes interpolation.
- Do not wrap arbitrary Worker constructors, rewrite blob workers, traverse private TradingView objects, or OCR chart pixels.
- Preserve the existing route/token identity checks, READY correlation, latest-payload replay, full and narrow axis-clear handling, disconnected-canvas handling, linear/log robust fit, and economic-value-aware jitter behavior.
- Every production change follows RED, verified RED, minimal GREEN, verified GREEN, then commit.
- Preserve unrelated files and worktree changes; stage only the files named by the current task.

---

## File Structure

- Modify `src/content/content.js`: own frame registration, monotonic document generation, widget-metadata sanitization, READY correlation, and construction of the per-frame delivery envelope.
- Modify `src/content/chart-main.js`: validate the delivery context, constrain scale selection, bind scales to source geometry and generation, render only in-plot coordinates, and keep bounded transient diagnostics.
- Modify `tests/content-runtime.test.js`: exercise parent-side frame metadata, generation, READY, route, and envelope behavior through the real instrumented content runtime.
- Modify `tests/markers.test.js`: exercise the real chart child message handler, Canvas hooks, robust selector, geometry projection, diagnostics, and OffscreenCanvas handoff behavior.
- Do not modify `src/content/markers.js`: it remains the canonical factual economic-coordinate producer.

---

### Task 1: Parent Axis Hint and Frame-Generation Envelope

**Files:**
- Modify: `src/content/content.js:6-25`
- Modify: `src/content/content.js:146-165`
- Modify: `src/content/content.js:221-255`
- Modify: `src/content/content.js:2182-2295`
- Test: `tests/content-runtime.test.js:287-590`
- Test: `tests/content-runtime.test.js:591-1170`

**Interfaces:**
- Consumes: a connected frame returned by `chartFrames()`, its current route capture, its `data-widget-options` attribute, the current detail-route token identity, and the existing canonical result of `chartMarkerPayload()`.
- Produces: `beginChartFrameGeneration(frame) -> number`, `chartAxisHint(frame) -> 'MARKET_CAP' | 'PRICE' | 'UNKNOWN'`, `chartDeliveryContext(frame) -> { axisHint, frameGeneration, probeId }`, and the exact message envelopes defined below.
- Produces READY probe:

```js
{
  source: 'TANGO_PAPER_PARENT',
  type: 'CHART_READY_PROBE',
  probeId: '2:17',
  frameGeneration: 6
}
```

- Produces marker delivery without changing `payload`:

```js
{
  source: 'TANGO_PAPER_PARENT',
  type: 'CHART_MARKERS',
  context: {
    axisHint: 'MARKET_CAP',
    frameGeneration: 6,
    probeId: '2:17'
  },
  payload: runtime.latestMarkerPayload
}
```

- Consumes correlated READY:

```js
{
  source: 'TANGO_PAPER_CHART',
  type: 'READY',
  probeId: '2:17',
  frameGeneration: 6,
  identity: { chain: 'sol', address: '5NJmSCu2v6aCakNYxVxR9pCta4ZR5bWHib1cvn47pump' }
}
```

- [ ] **Step 1: Extend the parent-runtime test frame with real frame attributes and message helpers**

Replace `chartFrame()` in `tests/content-runtime.test.js` with this fixture and add the two helpers immediately below it:

```js
function chartFrame({
  widgetOptions = '',
  isConnected = true,
  contentDocumentThrows = false
} = {}) {
  const messages = [];
  const listeners = new Map();
  const attributes = new Map();
  if (widgetOptions) attributes.set('data-widget-options', widgetOptions);
  const frame = {
    messages,
    isConnected,
    contentWindow: { postMessage(message) { messages.push(message); } },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    dispatch(type) {
      (listeners.get(type) || []).forEach((listener) => listener({ type, target: frame }));
    }
  };
  if (contentDocumentThrows) {
    Object.defineProperty(frame, 'contentDocument', {
      get() { throw new Error('contentDocument unavailable'); }
    });
  }
  return frame;
}

function chartMarkerMessages(frame) {
  return frame.messages.filter((message) => (
    message?.source === 'TANGO_PAPER_PARENT' && message?.type === 'CHART_MARKERS'
  ));
}

function chartReadyResponse(probe, identity) {
  const data = {
    source: 'TANGO_PAPER_CHART',
    type: 'READY',
    probeId: probe.probeId,
    frameGeneration: probe.frameGeneration
  };
  if (identity) data.identity = identity;
  return data;
}
```

Add `URLSearchParams` beside `URL` in the VM context created by `loadContent()`:

```js
URL,
URLSearchParams,
Map,
```

For every existing positive tagged READY fixture in this test file, retain its existing identity and use the exact probe returned by `chartReadyProbes(frame)`:

```js
const probe = chartReadyProbes(frame).at(-1);
loaded.api.dispatchWindowMessage({
  source: frame.contentWindow,
  data: chartReadyResponse(probe, chartReadyIdentity('base', ADDRESS_B))
});
```

For an existing negative fixture that intentionally mismatches the probe, retain that mismatch while supplying the current probe's generation:

```js
const probe = chartReadyProbes(frame).at(-1);
loaded.api.dispatchWindowMessage({
  source: frame.contentWindow,
  data: {
    ...chartReadyResponse(probe, chartReadyIdentity('base', ADDRESS_B)),
    probeId: `${probe.probeId}:stale`
  }
});
```

- [ ] **Step 2: Write RED tests for sanitized metadata and canonical-payload separation**

Add these tests after the chart helper functions:

```js
test('throwing contentDocument still receives its own sanitized MCAP frame context', () => {
  const widgetOptions = new URLSearchParams({
    symbol: `eth/${ADDRESS_A}/USD/MCAP`,
    interval: '1',
    workers: JSON.stringify({ enabled: true })
  }).toString();
  const frame = chartFrame({ widgetOptions, contentDocumentThrows: true });
  const loaded = loadContent({ chartFrames: [frame] });

  loaded.api.syncChartMarkers(true);

  const message = chartMarkerMessages(frame).at(-1);
  assert.equal(message.context.axisHint, 'MARKET_CAP');
  assert.equal(Number.isSafeInteger(message.context.frameGeneration), true);
  assert.ok(message.context.frameGeneration > 0);
  assert.equal(typeof message.context.probeId, 'string');
  assert.ok(message.context.probeId.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(message.payload)), { markers: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload)), { markers: [] });
  assert.equal(Object.hasOwn(loaded.api.runtime.latestMarkerPayload, 'axisHint'), false);
  assert.equal(Object.hasOwn(loaded.api.runtime.latestMarkerPayload, 'frameGeneration'), false);
});

test('an exact USD symbol produces a PRICE frame hint', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `eth/${ADDRESS_A}/USD`
    }).toString()
  });
  const loaded = loadContent({ chartFrames: [frame] });

  loaded.api.syncChartMarkers(true);

  assert.equal(chartMarkerMessages(frame).at(-1).context.axisHint, 'PRICE');
});

test('invalid frame metadata yields UNKNOWN without changing canonical markers', async (t) => {
  const cases = [
    {
      name: 'duplicate symbol',
      options: `symbol=eth%2F${ADDRESS_A}%2FUSD&symbol=eth%2F${ADDRESS_A}%2FUSD%2FMCAP`,
      connected: true
    },
    {
      name: 'wrong token',
      options: new URLSearchParams({ symbol: `eth/${ADDRESS_B}/USD/MCAP` }).toString(),
      connected: true
    },
    {
      name: 'ambiguous suffix',
      options: new URLSearchParams({ symbol: `eth/${ADDRESS_A}/USD/MCAP/PRICE` }).toString(),
      connected: true
    },
    {
      name: 'malformed percent encoding',
      options: 'symbol=%E0%A4%A',
      connected: true
    },
    {
      name: 'oversized metadata',
      options: `symbol=${'x'.repeat(8_193)}`,
      connected: true
    },
    {
      name: 'detached frame',
      options: new URLSearchParams({ symbol: `eth/${ADDRESS_A}/USD/MCAP` }).toString(),
      connected: false
    }
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const frame = chartFrame({
        widgetOptions: fixture.options,
        isConnected: fixture.connected
      });
      const loaded = loadContent({ chartFrames: [frame] });
      const before = JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload));

      loaded.api.syncChartMarkers(true);

      const message = chartMarkerMessages(frame).at(-1);
      assert.equal(message.context.axisHint, 'UNKNOWN');
      assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload)), before);
      assert.deepEqual(JSON.parse(JSON.stringify(message.payload)), before);
    });
  }
});

test('same frame re-reads an axis change without mutating or rebuilding canonical markers', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `eth/${ADDRESS_A}/USD/MCAP`
    }).toString()
  });
  const loaded = loadContent({ chartFrames: [frame] });
  loaded.api.syncChartMarkers(true);
  const first = chartMarkerMessages(frame).at(-1);
  const canonical = JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload));

  frame.setAttribute('data-widget-options', new URLSearchParams({
    symbol: `eth/${ADDRESS_A}/USD`
  }).toString());
  loaded.api.syncChartMarkers();

  const messages = chartMarkerMessages(frame);
  const second = messages.at(-1);
  assert.equal(messages.length, 2);
  assert.equal(first.context.axisHint, 'MARKET_CAP');
  assert.equal(second.context.axisHint, 'PRICE');
  assert.equal(second.context.frameGeneration, first.context.frameGeneration);
  assert.deepEqual(JSON.parse(JSON.stringify(second.payload)), canonical);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.api.runtime.latestMarkerPayload)), canonical);
});

test('reused frame metadata for the previous route is UNKNOWN in the new route generation', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `base/${ADDRESS_A}/USD/MCAP`
    }).toString()
  });
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });
  loaded.api.syncChartMarkers(true);
  const firstGeneration = chartMarkerMessages(frame).at(-1).context.frameGeneration;

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.handleRouteChange();

  const message = chartMarkerMessages(frame).at(-1);
  assert.ok(message.context.frameGeneration > firstGeneration);
  assert.equal(message.context.axisHint, 'UNKNOWN');
  assert.deepEqual(JSON.parse(JSON.stringify(message.payload)), { markers: [] });
});

test('reload advances frame generation and correlated READY replays only the latest token payload', () => {
  const frame = chartFrame({
    widgetOptions: new URLSearchParams({
      symbol: `base/${ADDRESS_A}/USD/MCAP`
    }).toString()
  });
  const loaded = loadContent({
    href: `https://gmgn.ai/base/token/${ADDRESS_A}`,
    chartFrames: [frame]
  });
  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_A, symbol: 'A' },
    quote: {
      priceUsd: 1,
      marketCapUsd: 1_000,
      source: 'GMGN',
      observedAt: loaded.clock.now
    }
  };
  loaded.api.runtime.state.positions[`base:${ADDRESS_A}`] = {
    chain: 'base',
    tokenAddress: ADDRESS_A,
    symbol: 'A',
    quantity: 1,
    averageEntryMarketCap: 1_000,
    averageEntryPriceUsd: 1
  };
  loaded.api.syncChartMarkers(true);
  const firstMessage = chartMarkerMessages(frame).at(-1);
  const firstGeneration = firstMessage.context.frameGeneration;

  loaded.context.location.href = `https://gmgn.ai/base/token/${ADDRESS_B}`;
  loaded.api.runtime.state.positions[`base:${ADDRESS_B}`] = {
    chain: 'base',
    tokenAddress: ADDRESS_B,
    symbol: 'B',
    quantity: 1,
    averageEntryMarketCap: 2_000,
    averageEntryPriceUsd: 2
  };
  loaded.api.handleRouteChange();
  frame.setAttribute('data-widget-options', new URLSearchParams({
    symbol: `base/${ADDRESS_B}/USD/MCAP`
  }).toString());
  frame.dispatch('load');

  const clearMessage = chartMarkerMessages(frame).at(-1);
  const currentProbe = chartReadyProbes(frame).at(-1);
  assert.ok(clearMessage.context.frameGeneration > firstGeneration);
  assert.equal(clearMessage.context.frameGeneration, currentProbe.frameGeneration);
  assert.deepEqual(JSON.parse(JSON.stringify(clearMessage.payload)), { markers: [] });

  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: {
      source: 'TANGO_PAPER_CHART',
      type: 'READY',
      probeId: currentProbe.probeId,
      frameGeneration: firstGeneration,
      identity: chartReadyIdentity('base', ADDRESS_B)
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(chartMarkerMessages(frame).at(-1).payload)), { markers: [] });

  loaded.api.runtime.current = {
    token: { chain: 'base', address: ADDRESS_B, symbol: 'B' },
    quote: {
      priceUsd: 2,
      marketCapUsd: 2_000,
      source: 'GMGN',
      observedAt: loaded.clock.now
    }
  };
  loaded.api.dispatchWindowMessage({
    source: frame.contentWindow,
    data: chartReadyResponse(currentProbe, chartReadyIdentity('base', ADDRESS_B))
  });

  const latest = chartMarkerMessages(frame).at(-1);
  assert.equal(latest.context.frameGeneration, currentProbe.frameGeneration);
  assert.equal(latest.context.probeId, currentProbe.probeId);
  assert.equal(latest.payload.tokenAddress, ADDRESS_B);
  assert.equal(latest.payload.markers[0].id, `entry:base:${ADDRESS_B}`);
});
```

- [ ] **Step 3: Run the metadata tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="sanitized MCAP frame context|exact USD symbol|invalid frame metadata|same frame re-reads|previous route is UNKNOWN|reload advances frame generation" tests/content-runtime.test.js
```

Expected: FAIL because current `CHART_MARKERS` messages have no `context`, and the first assertion reports that `message.context` is `undefined`.

- [ ] **Step 4: Add frame generation, strict widget parsing, and delivery-context helpers**

Add these fields to `runtime` in `src/content/content.js`:

```js
chartFrameGenerations: new WeakMap(),
chartFrameReadyProbeIds: new WeakMap(),
chartFrameGenerationSequence: 0,
```

Add these constants and helpers immediately after `chartReadyIdentity()`:

```js
const CHART_WIDGET_OPTIONS_MAX_CHARS = 8_192;
const CHART_SYMBOL_MAX_CHARS = 512;
const CHART_PROBE_ID_MAX_CHARS = 128;

function beginChartFrameGeneration(frame) {
  runtime.chartFrameGenerationSequence += 1;
  const generation = runtime.chartFrameGenerationSequence;
  runtime.chartFrameGenerations.set(frame, generation);
  runtime.chartFrameProbeIds.delete(frame);
  runtime.chartFrameReadyProbeIds.delete(frame);
  runtime.markerPayloads.delete(frame);
  return generation;
}

function chartAxisHint(frame) {
  try {
    if (!frame || frame.isConnected === false || ![...chartFrames()].includes(frame)) return 'UNKNOWN';
    if (!routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame))) return 'UNKNOWN';
    const routeToken = detailRouteToken();
    if (!routeToken) return 'UNKNOWN';
    const raw = frame.getAttribute?.('data-widget-options');
    if (typeof raw !== 'string' || !raw.length || raw.length > CHART_WIDGET_OPTIONS_MAX_CHARS) {
      return 'UNKNOWN';
    }
    const params = new URLSearchParams(raw);
    const symbols = params.getAll('symbol');
    if (symbols.length !== 1) return 'UNKNOWN';
    const symbol = symbols[0];
    if (!symbol || symbol.length > CHART_SYMBOL_MAX_CHARS || symbol.includes('\uFFFD')) return 'UNKNOWN';
    const parts = symbol.split('/');
    if (parts.length !== 3 && parts.length !== 4) return 'UNKNOWN';
    const identity = chartReadyIdentity({ chain: parts[0], address: parts[1] });
    if (!identity || identity.chain !== routeToken.chain || identity.address !== routeToken.address) {
      return 'UNKNOWN';
    }
    if (String(parts[2]).toUpperCase() !== 'USD') return 'UNKNOWN';
    if (parts.length === 3) return 'PRICE';
    return String(parts[3]).toUpperCase() === 'MCAP' ? 'MARKET_CAP' : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

function chartDeliveryContext(frame) {
  const generation = runtime.chartFrameGenerations.get(frame);
  const probeId = runtime.chartFrameReadyProbeIds.get(frame)
    || runtime.chartFrameProbeIds.get(frame)
    || '';
  return {
    axisHint: chartAxisHint(frame),
    frameGeneration: Number.isSafeInteger(generation) && generation > 0 ? generation : 0,
    probeId: typeof probeId === 'string' && probeId.length <= CHART_PROBE_ID_MAX_CHARS
      ? probeId
      : ''
  };
}
```

- [ ] **Step 5: Bind registration, route advance, load, probes, READY, and marker signatures to the generation**

In `advanceRouteEpoch()`, begin a fresh generation for every retained registered frame before the new probe:

```js
framesAwaitingRouteSeal.forEach((frame) => {
  runtime.chartFrameRoutes.set(frame, { epoch: runtime.routeEpoch, identity: nextIdentity });
  beginChartFrameGeneration(frame);
});
```

In the stale-route branch and first-seen branch of `registerChartFrame()`, call `beginChartFrameGeneration(frame)` after setting the current route capture and before probing:

```js
runtime.chartFrameRoutes.set(frame, captureRoute());
beginChartFrameGeneration(frame);
runtime.chartFrameTentative.add(frame);
```

For a first-seen frame:

```js
runtime.markerFrameListeners.add(frame);
if (routeEligible) {
  runtime.chartFrameRoutes.set(frame, captureRoute());
  beginChartFrameGeneration(frame);
}
```

Replace `probeChartFrameReady()` with:

```js
function probeChartFrameReady(frame) {
  const target = frame?.contentWindow;
  if (!target || !routeCaptureIsCurrent(runtime.chartFrameRoutes.get(frame))) return false;
  let frameGeneration = runtime.chartFrameGenerations.get(frame);
  if (!Number.isSafeInteger(frameGeneration) || frameGeneration <= 0) {
    frameGeneration = beginChartFrameGeneration(frame);
  }
  runtime.chartProbeSequence += 1;
  const probeId = `${runtime.routeEpoch}:${runtime.chartProbeSequence}`;
  runtime.chartFrameProbeIds.set(frame, probeId);
  target.postMessage({
    source: 'TANGO_PAPER_PARENT',
    type: 'CHART_READY_PROBE',
    probeId,
    frameGeneration
  }, '*');
  return true;
}
```

In the frame load listener, preserve the existing `readyBeforeLoad` exception. For every other load, begin a generation, then probe before delivering the quarantined clear:

```js
const readyBeforeLoad = runtime.chartFrameReadyBeforeLoad.delete(frame);
if (!routeCurrent || !readyBeforeLoad) {
  Tango.GMGN._invalidateChartFrame?.(frame);
  runtime.chartFrameTentative.add(frame);
  runtime.chartFrameAwaitingReady.delete(frame);
  if (routeCurrent) runtime.chartFrameAwaitingReady.add(frame);
  beginChartFrameGeneration(frame);
} else {
  runtime.chartFrameAwaitingReady.delete(frame);
}
runtime.markerPayloads.delete(frame);
probeChartFrameReady(frame);
deliverChartMarkers([frame], runtime.latestMarkerPayload, true);
```

In `handlePageMessage()`, replace the current probe-only validation with exact probe and generation validation:

```js
const hasProbeId = Object.prototype.hasOwnProperty.call(event.data || {}, 'probeId');
const hasFrameGeneration = Object.prototype.hasOwnProperty.call(event.data || {}, 'frameGeneration');
const probeTagged = hasProbeId || hasFrameGeneration;
const probeId = typeof event.data?.probeId === 'string' ? event.data.probeId : '';
const frameGeneration = event.data?.frameGeneration;
const expectedProbeId = runtime.chartFrameProbeIds.get(frame);
const expectedGeneration = runtime.chartFrameGenerations.get(frame);
if (probeTagged && (
  !hasProbeId
  || !hasFrameGeneration
  || !routeCurrent
  || !probeId
  || probeId.length > CHART_PROBE_ID_MAX_CHARS
  || !Number.isSafeInteger(frameGeneration)
  || frameGeneration <= 0
  || expectedProbeId !== probeId
  || expectedGeneration !== frameGeneration
)) return;
```

Remove the existing unconditional `if (routeCurrent) runtime.chartFrameProbeIds.delete(frame);` statement. When `_markChartFrameReady()` succeeds for a tagged response, retain its accepted correlation before removing the outstanding probe; an untagged READY does not consume the outstanding correlation:

```js
if (probeTagged) {
  runtime.chartFrameReadyProbeIds.set(frame, probeId);
  runtime.chartFrameProbeIds.delete(frame);
}
```

Replace the signature and `postMessage()` portion of `deliverChartMarkers()` with:

```js
const context = chartDeliveryContext(frame);
const signature = JSON.stringify({ context, payload: deliveredPayload });
if ((!force || tentative) && !registrationChanged
  && runtime.markerPayloads.get(frame) === signature) return;
runtime.markerPayloads.set(frame, signature);
frame.contentWindow?.postMessage({
  source: 'TANGO_PAPER_PARENT',
  type: 'CHART_MARKERS',
  context,
  payload: deliveredPayload
}, '*');
```

- [ ] **Step 6: Run the metadata tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="sanitized MCAP frame context|exact USD symbol|invalid frame metadata|same frame re-reads|previous route is UNKNOWN|reload advances frame generation" tests/content-runtime.test.js
```

Expected: PASS. The workers option has no effect on the hint, the throwing `contentDocument` getter is never read, every invalid case yields only `UNKNOWN`, stale READY generations are rejected, and only the latest token payload is replayed.

- [ ] **Step 7: Run the complete parent-runtime regression**

Run:

```powershell
node --test tests/content-runtime.test.js tests/content-structure.test.js
```

Expected: PASS with no unhandled rejection or warning.

- [ ] **Step 8: Commit the parent envelope**

```powershell
git add src/content/content.js tests/content-runtime.test.js
git commit -m "fix: bind chart delivery to sanitized frame context"
```

---

### Task 2: Child Context Validation and Axis-Constrained Scale Selection

**Files:**
- Modify: `src/content/chart-main.js:10-30`
- Modify: `src/content/chart-main.js:213-281`
- Modify: `src/content/chart-main.js:477-530`
- Test: `tests/markers.test.js:20-148`
- Test: `tests/markers.test.js:798-1213`

**Interfaces:**
- Consumes: the Task 1 `CHART_READY_PROBE` and `CHART_MARKERS.context` schemas.
- Produces: READY responses that echo `probeId` and `frameGeneration`, `normalizedFrameContext(value) -> { axisHint, frameGeneration, probeId } | null`, `applyFrameContext(value) -> boolean`, and a selected scale whose `type` cannot conflict with an explicit hint.
- Preserves: an initial document's pre-message Canvas anchors may be adopted by its first valid context; every later generation, probe, or hint change sets a new axis-sequence boundary and requires new anchors.

- [ ] **Step 1: Give chart tests a valid default context while retaining a raw-message path**

In `loadChartBridge()`, add this context after `clock`:

```js
const defaultFrameContext = {
  axisHint: 'UNKNOWN',
  frameGeneration: 1,
  probeId: 'test:1'
};
```

Extend the instrumented snapshot with a guarded context field:

```js
frameContext: typeof activeFrameContext === 'undefined' ? null : activeFrameContext,
```

Replace the returned message helper and add a raw helper:

```js
message: (data, source = context.window.parent) => {
  const delivered = data?.source === 'TANGO_PAPER_PARENT'
    && data?.type === 'CHART_MARKERS'
    && !Object.prototype.hasOwnProperty.call(data, 'context')
    ? { ...data, context: { ...defaultFrameContext } }
    : data;
  listeners.get('message')({ data: delivered, source });
},
rawMessage: (data, source = context.window.parent) => {
  listeners.get('message')({ data, source });
},
markers: (payload, frameContext = defaultFrameContext) => {
  listeners.get('message')({
    source: context.window.parent,
    data: {
      source: 'TANGO_PAPER_PARENT',
      type: 'CHART_MARKERS',
      context: { ...frameContext },
      payload
    }
  });
},
```

Update the existing probe recovery test to use the Task 1 schema:

```js
chart.message({
  source: 'TANGO_PAPER_PARENT',
  type: 'CHART_READY_PROBE',
  probeId: 'probe-1',
  frameGeneration: 1
});
const ready = readyMessages()[0];
assert.equal(ready.probeId, 'probe-1');
assert.equal(ready.frameGeneration, 1);
```

- [ ] **Step 2: Write RED tests for exact mode ties, context changes, and older messages**

Add these tests after the existing positive-marker mode-selection tests:

```js
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
```

- [ ] **Step 3: Run the context-selection tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="hint resolves an exact|new frame context rejects|same-generation axis hint change|malformed frame context" tests/markers.test.js
```

Expected: FAIL. The MARKET_CAP tie selects PRICE because current mode insertion order wins the tie, and generation 2 does not invalidate the scale.

- [ ] **Step 4: Add context validation, context invalidation, and READY echoing**

Add these declarations beside the existing chart state:

```js
const CHART_AXIS_HINTS = new Set(['MARKET_CAP', 'PRICE', 'UNKNOWN']);
const CHART_PROBE_ID_MAX_CHARS = 128;
let activeFrameContext = null;
```

Add these functions before the message listener:

```js
function normalizedFrameContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!CHART_AXIS_HINTS.has(value.axisHint)) return null;
  if (!Number.isSafeInteger(value.frameGeneration) || value.frameGeneration <= 0) return null;
  if (typeof value.probeId !== 'string'
    || !value.probeId
    || value.probeId.length > CHART_PROBE_ID_MAX_CHARS) return null;
  return {
    axisHint: value.axisHint,
    frameGeneration: value.frameGeneration,
    probeId: value.probeId
  };
}

function clearScaleAndPlacementCaches() {
  lastScaleMode = null;
  stableScale = null;
  stableSignature = '';
  renderedSignature = '';
  markerPositions.clear();
  markerEconomicCoordinates.clear();
  if (overlay?.childElementCount) overlay.replaceChildren();
}

function applyFrameContext(next) {
  if (!next) return false;
  if (activeFrameContext && next.frameGeneration < activeFrameContext.frameGeneration) return false;
  const changed = Boolean(activeFrameContext) && (
    next.frameGeneration !== activeFrameContext.frameGeneration
    || next.probeId !== activeFrameContext.probeId
    || next.axisHint !== activeFrameContext.axisHint
  );
  if (changed) {
    markerAxisSequenceFloor = axisLabelSequence;
    clearScaleAndPlacementCaches();
  }
  activeFrameContext = next;
  return true;
}
```

Replace `announceReady()` and the probe branch with:

```js
function announceReady(probeId = '', frameGeneration = 0) {
  const message = { source: 'TANGO_PAPER_CHART', type: 'READY' };
  if (probeId && Number.isSafeInteger(frameGeneration) && frameGeneration > 0) {
    message.probeId = probeId;
    message.frameGeneration = frameGeneration;
  }
  const identity = childTokenIdentity();
  if (identity) message.identity = identity;
  window.parent.postMessage(message, '*');
}

if (event.data.type === 'CHART_READY_PROBE') {
  const probeId = typeof event.data.probeId === 'string' ? event.data.probeId : '';
  const frameGeneration = event.data.frameGeneration;
  if (probeId
    && probeId.length <= CHART_PROBE_ID_MAX_CHARS
    && Number.isSafeInteger(frameGeneration)
    && frameGeneration > 0) {
    announceReady(probeId, frameGeneration);
  }
  return;
}
```

In the `CHART_MARKERS` branch, validate payload and token identity first. Immediately before calculating `identityChanged`, add:

```js
const nextFrameContext = normalizedFrameContext(event.data.context);
if (!nextFrameContext) return;
if (!applyFrameContext(nextFrameContext)) return;
```

Use `clearScaleAndPlacementCaches()` inside the existing empty-payload and identity-change reset branch, while retaining `hiddenMarkerIds.clear()` there:

```js
if (!nextState?.markers?.length || identityChanged) {
  clearScaleAndPlacementCaches();
  hiddenMarkerIds.clear();
}
```

- [ ] **Step 5: Constrain modes and record the frame context in each accepted scale**

Replace the current unconditional mode population in `selectScale()` with:

```js
const axisHint = activeFrameContext?.axisHint || 'UNKNOWN';
const permitPrice = axisHint !== 'MARKET_CAP';
const permitMarketCap = axisHint !== 'PRICE';
if (permitPrice) addPriceMode(markerState.currentPrice);
if (permitMarketCap) addMarketCapModes(markerState.currentMarketCap);
visibleMarkers.forEach((marker) => {
  if (permitPrice) addPriceMode(marker.price);
  if (permitMarketCap) addMarketCapModes(marker.marketCap);
});
```

After selecting a candidate, attach the validated context without mutating its points:

```js
const selectedWithContext = {
  ...selected,
  axisHint,
  frameGeneration: activeFrameContext.frameGeneration,
  probeId: activeFrameContext.probeId
};
const signature = `${selectedWithContext.frameGeneration}:${selectedWithContext.probeId}:${axisHint}:${selected.type}:${selected.factor}:${selected.points.map((point) => `${Math.round(point.y / 3)}:${Number(point.value).toPrecision(5)}`).join('|')}`;
const sameMode = stableScale?.type === selected.type
  && stableScale?.factor === selected.factor
  && stableScale?.frameGeneration === selectedWithContext.frameGeneration
  && stableScale?.probeId === selectedWithContext.probeId
  && stableScale?.axisHint === axisHint;
if (sameMode && stableSignature === signature) return stableScale;
stableScale = selectedWithContext;
stableSignature = signature;
scaleUpdatedAt = Date.now();
return stableScale;
```

- [ ] **Step 6: Run the context-selection tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="hint resolves an exact|new frame context rejects|same-generation axis hint change|malformed frame context" tests/markers.test.js
```

Expected: PASS. Each explicit hint selects only its own dimension, generation 2 clears generation 1 anchors, and a later generation 1 message is ignored.

- [ ] **Step 7: Run all marker and parent transport regressions**

Run:

```powershell
node --test tests/markers.test.js tests/content-runtime.test.js
```

Expected: PASS. Existing identity, empty-clear, idle-scale, narrow-clear, resize, and disconnected-canvas tests remain green.

- [ ] **Step 8: Commit child context enforcement**

```powershell
git add src/content/chart-main.js tests/markers.test.js
git commit -m "fix: constrain chart scales to current frame context"
```

---

### Task 3: Current Source Geometry and In-Plot Hide/Show

**Files:**
- Modify: `src/content/chart-main.js:53-86`
- Modify: `src/content/chart-main.js:202-281`
- Modify: `src/content/chart-main.js:303-381`
- Test: `tests/markers.test.js:20-148`
- Test: `tests/markers.test.js:818-1160`

**Interfaces:**
- Consumes: the selected Canvas entry, at least three accepted client-coordinate anchors, its current `getBoundingClientRect()`, current viewport dimensions, and the factual marker coordinate already present in the canonical payload.
- Produces: `currentSourceGeometry(canvas, points, tickSpacing) -> { viewport, sourceRect, plotBounds } | null`, `scaleGeometryIsCurrent(scale) -> boolean`, and overlay styles derived from the same source rectangle.
- Defines plot bounds as the intersection of the current source rectangle, current viewport, the left edge of the observed right-axis labels, and one observed vertical tick beyond the outer anchors.

- [ ] **Step 1: Make the chart test canvas rectangle and viewport controllable**

Extend the `loadChartBridge()` arguments:

```js
canvasRect: initialCanvasRect = { left: 0, top: 0, width: 1_200, height: 700 },
viewport: initialViewport = { width: 1_200, height: 800 }
```

Create mutable geometry before the VM context:

```js
const canvasRect = { ...initialCanvasRect };
const viewport = { ...initialViewport };
```

Use it in the VM context and canvas:

```js
innerWidth: viewport.width,
innerHeight: viewport.height,
```

```js
const canvas = {
  isConnected: true,
  width: 1_000,
  height: 700,
  getBoundingClientRect: () => ({ ...canvasRect })
};
```

Extend the snapshot and returned fixture:

```js
overlayStyles: overlay?.children?.map((node) => ({ ...node.style })) || [],
```

```js
setCanvasRect(next) { Object.assign(canvasRect, next); },
setViewport(next) {
  Object.assign(viewport, next);
  context.window.innerWidth = viewport.width;
  context.window.innerHeight = viewport.height;
},
```

In the instrumented `seedAxisRecords()` helper, bind every seeded anchor to the fixture's current source/viewport signature when Task 3 production code is present:

```js
const observedRect = context.canvas.getBoundingClientRect();
const observedSourceSignature = typeof sourceObservationSignature === 'function'
  ? sourceObservationSignature(observedRect)
  : '';
samples.forEach((sample) => records.set(sample.text, {
  text: sample.text,
  value: parseNumber(sample.text),
  y: sample.y,
  x: 950,
  id,
  generation: sample.generation,
  sequence: ++axisLabelSequence,
  updatedAt: sample.updatedAt,
  sourceObservationSignature: observedSourceSignature
}));
```

- [ ] **Step 2: Write the RED hide-enter-leave test**

Add this test after the current right-axis placement test:

```js
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
```

- [ ] **Step 3: Write RED tests for transformed client coordinates and stale geometry**

Add these tests beside the hide-enter-leave test:

```js
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
```

- [ ] **Step 4: Run geometry tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="inside current plot bounds|one transformed current source rectangle|moved source rectangle" tests/markers.test.js
```

Expected: FAIL. Current rendering uses `35`, `innerHeight - 55`, `left: 0`, and `right: 58px`, and it retains a scale after a source rectangle moves.

- [ ] **Step 5: Add source-observation and current-geometry helpers**

Add `sourceObservationSignature()` before `recordLabel()` so each anchor can carry the exact source/viewport geometry under which its client coordinates were observed:

```js
function sourceObservationSignature(rect) {
  const values = [
    Number(innerWidth),
    Number(innerHeight),
    Number(rect?.left),
    Number(rect?.top),
    Number(rect?.width),
    Number(rect?.height)
  ];
  if (!values.every(Number.isFinite)) return '';
  return values.map((number) => number.toFixed(2)).join(':');
}
```

Add the remaining functions immediately before `selectScale()`:

```js
function finiteRect(canvas) {
  if (!canvas?.isConnected) return null;
  let rect;
  try { rect = canvas.getBoundingClientRect(); } catch { return null; }
  const left = Number(rect?.left);
  const top = Number(rect?.top);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 20 || height < 20) return null;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function currentSourceGeometry(canvas, points, tickSpacing) {
  const sourceRect = finiteRect(canvas);
  const viewport = { width: Number(innerWidth), height: Number(innerHeight) };
  if (!sourceRect
    || !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
    || !Array.isArray(points)
    || points.length < 3
    || !(tickSpacing > 0)) return null;
  const xs = points.map((point) => Number(point.x)).filter(Number.isFinite);
  const ys = points.map((point) => Number(point.y)).filter(Number.isFinite);
  if (xs.length < 3 || ys.length < 3) return null;
  const plotBounds = {
    left: Math.max(0, sourceRect.left),
    right: Math.min(viewport.width, sourceRect.right, Math.min(...xs)),
    top: Math.max(0, sourceRect.top, Math.min(...ys) - tickSpacing),
    bottom: Math.min(viewport.height, sourceRect.bottom, Math.max(...ys) + tickSpacing)
  };
  if (!(plotBounds.right > plotBounds.left) || !(plotBounds.bottom > plotBounds.top)) return null;
  return { viewport, sourceRect, plotBounds };
}

function geometrySignature(value) {
  if (!value) return '';
  const numbers = [
    value.viewport.width,
    value.viewport.height,
    value.sourceRect.left,
    value.sourceRect.top,
    value.sourceRect.width,
    value.sourceRect.height,
    value.plotBounds.left,
    value.plotBounds.right,
    value.plotBounds.top,
    value.plotBounds.bottom
  ];
  return numbers.map((number) => Number(number).toFixed(2)).join(':');
}

function scaleGeometryIsCurrent(scale) {
  const entry = labelsByCanvas.get(scale?.sourceId);
  if (!entry?.canvas?.isConnected) return false;
  const current = currentSourceGeometry(entry.canvas, scale.points, scale.tickSpacing);
  return geometrySignature(current) === scale.geometrySignature;
}
```

- [ ] **Step 6: Bind anchors to observation geometry, retain source identity, and store current geometry**

Add the observation signature to every accepted point in `recordLabel()`:

```js
const observedSourceSignature = sourceObservationSignature(rect);
if (!observedSourceSignature) return;
records.set(String(text), {
  text: String(text),
  value,
  y: clientY,
  x: clientX,
  id,
  generation: Number(clearedAt || 0),
  sequence: ++axisLabelSequence,
  updatedAt: Date.now(),
  sourceObservationSignature: observedSourceSignature
});
```

Change the start of the group pipeline in `selectScale()` from values-only mapping to entries with source identity:

```js
const groups = [...labelsByCanvas.entries()].flatMap(([sourceId, entry]) => {
  const currentRect = finiteRect(entry.canvas);
  const currentObservationSignature = sourceObservationSignature(currentRect);
  const points = [...entry.records.values()].filter((point) => (
    point.sourceObservationSignature === currentObservationSignature
  ));
  if (!currentObservationSignature || !points.length) return [];
  const latestGeneration = Math.max(0, ...points.map((point) => Number(point.generation || 0)));
  const afterBoundary = points.filter((point) => Number(point.sequence || 0) > markerAxisSequenceFloor);
  const eligibleGroups = [
    afterBoundary.filter((point) => now - point.updatedAt <= AXIS_LABEL_FRESH_MS
      || Number(point.generation || 0) === latestGeneration),
    afterBoundary.filter((point) => now - point.updatedAt <= AXIS_LABEL_FRESH_MS)
  ];
  return eligibleGroups.map((eligible) => {
    const deduped = new Map();
    eligible.forEach((point) => deduped.set(Math.round(point.y / 2) * 2, point));
    return {
      sourceId,
      canvas: entry.canvas,
      points: [...deduped.values()].sort((left, right) => left.y - right.y)
    };
  });
}).filter((group) => group.points.length >= 3
  && new Set(group.points.map((point) => point.value)).size >= 3)
  .map((group) => {
    const linear = robustFit(group.points, false);
    const logarithmic = robustFit(group.points, true);
    const fit = !linear
      ? logarithmic
      : !logarithmic
        ? linear
        : linear.error <= logarithmic.error ? linear : logarithmic;
    const tickSpacing = median(group.points.slice(1)
      .map((point, index) => Math.abs(point.y - group.points[index].y)));
    if (!fit || fit.error > Math.max(4, tickSpacing * 0.18)) return { ...group, fit: null };
    const geometry = currentSourceGeometry(group.canvas, group.points, tickSpacing);
    return { ...group, fit, tickSpacing, geometry };
  }).filter((group) => group.fit && group.geometry);
```

Replace the current candidate loop with this source-aware version so every referenced geometry field is in scope:

```js
const candidates = [];
groups.forEach(({
  sourceId, points, fit, tickSpacing, geometry
}) => modes.forEach((mode) => {
  const nearest = Math.min(...points
    .map((point) => Math.abs(Math.log(point.value / mode.current))));
  const span = Math.max(1, points.at(-1).y - points[0].y);
  const score = nearest + Math.min(2, fit.error / span * 8);
  candidates.push({
    ...mode,
    sourceId,
    points,
    fit,
    tickSpacing,
    viewport: geometry.viewport,
    sourceRect: geometry.sourceRect,
    plotBounds: geometry.plotBounds,
    geometrySignature: geometrySignature(geometry),
    axisGeneration: Math.max(...points.map((point) => Number(point.generation || 0))),
    observedAt: Math.max(...points.map((point) => Number(point.updatedAt || 0))),
    fitError: fit.error,
    score
  });
}));
```

Include `sourceId`, `axisGeneration`, and `geometrySignature` in `stableSignature`.

- [ ] **Step 7: Render from plot bounds, remove extrapolation guards, and scope the deadband**

At the start of `renderMarkers()`, reject a previously stable source before `selectScale()` can consider any records, then validate the selected scale as well:

```js
if (stableScale && !scaleGeometryIsCurrent(stableScale)) {
  markerAxisSequenceFloor = axisLabelSequence;
  clearScaleAndPlacementCaches();
  return;
}
const scale = selectScale(visibleMarkers);
if (!scale) {
  if (root.childElementCount) root.replaceChildren();
  renderedSignature = '';
  return;
}
if (!scaleGeometryIsCurrent(scale)) {
  markerAxisSequenceFloor = axisLabelSequence;
  clearScaleAndPlacementCaches();
  return;
}
```

Remove the existing axis-value one-tick extrapolation block and hard-coded vertical check:

```js
const axisValues = scale.points.map((point) => (
  scale.fit.logarithmic ? Math.log(point.value) : point.value
)).sort((left, right) => left - right);
const axisTick = median(axisValues.slice(1)
  .map((value, index) => Math.abs(value - axisValues[index])));
if (axisTick > 0 && (fitX < axisValues[0] - axisTick || fitX > axisValues.at(-1) + axisTick)) return;
```

Replace it with the factual projected-pixel check:

```js
const targetY = scale.fit.slope * fitX + scale.fit.intercept;
if (!Number.isFinite(targetY)
  || targetY < scale.plotBounds.top
  || targetY > scale.plotBounds.bottom) return;
```

Build the deadband key from every approved invariant:

```js
const placementContext = [
  scale.type,
  scale.factor,
  scale.frameGeneration,
  scale.probeId,
  scale.sourceId,
  scale.axisGeneration,
  scale.geometrySignature,
  rawValue
].join(':');
const sameEconomicCoordinate = markerEconomicCoordinates.get(marker.id) === placementContext;
const y = sameEconomicCoordinate
  && Number.isFinite(previousY)
  && Math.abs(previousY - targetY) < 3
  ? previousY
  : targetY;
markerEconomicCoordinates.set(marker.id, placementContext);
```

Replace the line bounds with:

```js
Object.assign(line.style, {
  borderTop: `1px dashed ${color}`,
  color,
  left: `${Math.round(scale.plotBounds.left)}px`,
  position: 'fixed',
  right: `${Math.max(0, Math.round(innerWidth - scale.plotBounds.right))}px`,
  top: `${Math.round(y)}px`,
  opacity: '.94'
});
```

- [ ] **Step 8: Update the deadband regression to match the approved invariants**

Replace the existing whole-axis 2px-shift expectation with an unchanged-bounds fit-jitter case:

```js
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
```

The moved-source test from Step 3 proves that a geometry change cannot use this deadband.

- [ ] **Step 9: Run geometry and marker regressions**

Run:

```powershell
node --test --test-name-pattern="inside current plot bounds|one transformed current source rectangle|moved source rectangle|unchanged economics and plot bounds" tests/markers.test.js
node --test tests/markers.test.js
```

Expected: both commands PASS. The marker is absent outside the plot, appears at `350px` after a current in-plot scale arrives, and disappears when it leaves again.

- [ ] **Step 10: Commit source-bound projection**

```powershell
git add src/content/chart-main.js tests/markers.test.js
git commit -m "fix: project chart markers inside current plot bounds"
```

---

### Task 4: Bounded Diagnostics and Worker-Handoff Fail-Closed Behavior

**Files:**
- Modify: `src/content/chart-main.js:10-30`
- Modify: `src/content/chart-main.js:53-155`
- Modify: `src/content/chart-main.js:202-381`
- Test: `tests/markers.test.js:20-148`
- Test: `tests/markers.test.js:798-1623`

**Interfaces:**
- Consumes: Window-realm Canvas text calls, accepted numeric-anchor sequence, selected source ID, `HTMLCanvasElement.transferControlToOffscreen()`, active frame context, and scale-selection outcomes.
- Produces: one transient fixed-shape diagnostic `{ reason, axisHint, frameGeneration }`; it is exposed only by the VM test instrumentation and is neither posted nor persisted.
- Produces diagnostic reasons: `IDLE`, `NO_TEXT_CALLS`, `NO_NUMERIC_LABELS`, `TOO_FEW_ANCHORS`, `STALE_GENERATION`, `REJECTED_FIT`, `REJECTED_MODE`, `SOURCE_DISCONNECTED`, `VIEWPORT_CHANGED`, `OUT_OF_PLOT`, `WORKER_ONLY`, and `RENDERED`.

- [ ] **Step 1: Give the chart fixture a real HTMLCanvasElement prototype and expose diagnostics**

Add this class after `FakeCanvasRenderingContext2D` in `loadChartBridge()`:

```js
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
```

Add the class to the VM context:

```js
HTMLCanvasElement: FakeHTMLCanvasElement,
CanvasRenderingContext2D: FakeCanvasRenderingContext2D,
```

Replace the original canvas literal with:

```js
const canvas = new FakeHTMLCanvasElement(canvasRect);
```

Replace the returned unrelated-canvas helper as well, so it exercises the same
prototype wrapper as a browser-created canvas:

```js
createCanvasContext: () => new FakeCanvasRenderingContext2D(
  new FakeHTMLCanvasElement({ ...canvasRect })
)
```

Extend the instrumented snapshot with guarded diagnostics:

```js
diagnostic: typeof chartDiagnostic === 'undefined'
  ? null
  : JSON.parse(JSON.stringify(chartDiagnostic)),
```

- [ ] **Step 2: Write RED tests for no-anchor diagnostics and worker handoff**

Add these tests after the disconnected-canvas tests:

```js
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
```

- [ ] **Step 3: Write RED table tests for the remaining scale-rejection reasons**

Add this test beside the tests from Step 2:

```js
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
```

- [ ] **Step 4: Run diagnostic tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="bounded diagnostics|worker handoff|distinct diagnostics|scale diagnostics distinguish" tests/markers.test.js
```

Expected: FAIL because `chartDiagnostic` does not exist and transferring the still-connected active canvas does not invalidate its scale.

- [ ] **Step 5: Add fixed-shape diagnostics and text-call accounting**

Add these declarations beside existing state:

```js
const CHART_DIAGNOSTIC_REASONS = new Set([
  'IDLE',
  'NO_TEXT_CALLS',
  'NO_NUMERIC_LABELS',
  'TOO_FEW_ANCHORS',
  'STALE_GENERATION',
  'REJECTED_FIT',
  'REJECTED_MODE',
  'SOURCE_DISCONNECTED',
  'VIEWPORT_CHANGED',
  'OUT_OF_PLOT',
  'WORKER_ONLY',
  'RENDERED'
]);
const workerOwnedCanvases = new WeakSet();
let textCallSequence = 0;
let frameContextTextFloor = 0;
let lastScaleInvalidationReason = '';
let chartDiagnostic = {
  reason: 'IDLE',
  axisHint: 'UNKNOWN',
  frameGeneration: 0
};

function setChartDiagnostic(reason) {
  const safeReason = CHART_DIAGNOSTIC_REASONS.has(reason) ? reason : 'IDLE';
  chartDiagnostic = {
    reason: safeReason,
    axisHint: activeFrameContext?.axisHint || 'UNKNOWN',
    frameGeneration: activeFrameContext?.frameGeneration || 0
  };
}
```

At the first line of `recordLabel()`, count every Window Canvas text observation, then ignore transferred canvases:

```js
textCallSequence += 1;
if (workerOwnedCanvases.has(context?.canvas)) return;
```

In `applyFrameContext()`, capture the text boundary whenever an established context changes:

```js
frameContextTextFloor = textCallSequence;
```

- [ ] **Step 6: Centralize canvas-source invalidation and instrument verified Offscreen handoff**

Add this helper before Canvas prototype instrumentation:

```js
function invalidateCanvasSource(canvas, reason) {
  const id = canvasIds.get(canvas);
  const ownedRecords = id ? labelsByCanvas.get(id) : null;
  const ownedScale = Boolean(id && stableScale?.sourceId === id);
  const relevantUnselectedSource = !stableScale && Boolean(ownedRecords?.records?.size);
  const workerReplacedActiveRenderer = reason === 'WORKER_ONLY' && Boolean(stableScale);
  if (id) labelsByCanvas.delete(id);
  if (ownedScale || workerReplacedActiveRenderer) clearScaleAndPlacementCaches();
  if (ownedScale || relevantUnselectedSource || workerReplacedActiveRenderer) {
    lastScaleInvalidationReason = reason;
    setChartDiagnostic(reason);
  }
}
```

Replace the manual label/scale deletion inside the existing qualifying
`clearRect` branch with this exact block, so invalidation sees the selected
source before it is cleared:

```js
if (this.canvas && clearsAxisSnapshot(this, x, y, width, height)) {
  const clearedAt = ++clearSequence;
  canvasClearedAt.set(this.canvas, clearedAt);
  canvasConsumedClearAt.set(this.canvas, clearedAt);
  invalidateCanvasSource(this.canvas, 'STALE_GENERATION');
}
```

A normal clear remains exact-canvas-scoped. A dynamically observed Offscreen
handoff clears any current stable scale because the renderer may have switched
to the transferred canvas while the old source node remains connected; this is
the approved fail-closed behavior.

Add this instrumentation after the Canvas 2D prototype wrapper:

```js
const canvasProto = window.HTMLCanvasElement?.prototype;
if (canvasProto?.transferControlToOffscreen) {
  const originalTransferControlToOffscreen = canvasProto.transferControlToOffscreen;
  canvasProto.transferControlToOffscreen = function tangoTransferControlToOffscreen(...args) {
    const result = originalTransferControlToOffscreen.apply(this, args);
    workerOwnedCanvases.add(this);
    invalidateCanvasSource(this, 'WORKER_ONLY');
    return result;
  };
}
```

This hook observes a real browser handoff. It does not inspect or replace a Worker and does not treat `workers.enabled` as evidence.

- [ ] **Step 7: Assign one bounded reason at each selection and render exit**

At the start of `selectScale()`, calculate post-context observations:

```js
const postContextTextCalls = textCallSequence - frameContextTextFloor;
const postContextNumericLabels = axisLabelSequence - markerAxisSequenceFloor;
```

Use these exact exits while building groups:

```js
if (!labelsByCanvas.size && [
  'WORKER_ONLY', 'SOURCE_DISCONNECTED', 'STALE_GENERATION'
].includes(lastScaleInvalidationReason)) {
  setChartDiagnostic(lastScaleInvalidationReason);
  return null;
}
if (!labelsByCanvas.size && postContextTextCalls <= 0) {
  setChartDiagnostic('NO_TEXT_CALLS');
  return null;
}
if (!labelsByCanvas.size && postContextNumericLabels <= 0) {
  setChartDiagnostic('NO_NUMERIC_LABELS');
  return null;
}
```

Before robust fitting, distinguish sparse and stale records:

```js
const postBoundaryPoints = [...labelsByCanvas.values()]
  .flatMap((entry) => [...entry.records.values()])
  .filter((point) => Number(point.sequence || 0) > markerAxisSequenceFloor);
if (postBoundaryPoints.length < 3
  || new Set(postBoundaryPoints.map((point) => point.value)).size < 3) {
  setChartDiagnostic(markerAxisSequenceFloor > 0 && postBoundaryPoints.length === 0
    ? 'STALE_GENERATION'
    : 'TOO_FEW_ANCHORS');
  return null;
}
```

If three or more unique points exist but no group passes robust fit, use:

```js
setChartDiagnostic('REJECTED_FIT');
return null;
```

If an explicit axis hint leaves no factual modes or every permitted candidate misses the score threshold, use:

```js
setChartDiagnostic('REJECTED_MODE');
stableScale = null;
stableSignature = '';
return null;
```

Replace `discardDisconnectedCanvasRecords()` with this ordered version so the
selected-source decision is made before its records and scale are cleared:

```js
function discardDisconnectedCanvasRecords() {
  labelsByCanvas.forEach((entry, id) => {
    if (entry.canvas?.isConnected) return;
    const ownedScale = stableScale?.sourceId === id;
    labelsByCanvas.delete(id);
    if (!ownedScale) return;
    clearScaleAndPlacementCaches();
    lastScaleInvalidationReason = 'SOURCE_DISCONNECTED';
    setChartDiagnostic('SOURCE_DISCONNECTED');
  });
}
```

When `scaleGeometryIsCurrent(scale)` fails, use:

```js
lastScaleInvalidationReason = 'VIEWPORT_CHANGED';
setChartDiagnostic('VIEWPORT_CHANGED');
```

When a factual target falls outside `plotBounds`, use:

```js
setChartDiagnostic('OUT_OF_PLOT');
```

After at least one line node is built, clear the prior invalidation reason and record success:

```js
if (nodes.length) {
  lastScaleInvalidationReason = '';
  setChartDiagnostic('RENDERED');
}
```

- [ ] **Step 8: Run diagnostics and worker tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="bounded diagnostics|worker handoff|distinct diagnostics|scale diagnostics distinguish" tests/markers.test.js
```

Expected: PASS. The diagnostic has exactly three scalar fields, includes no token identity, and the transferred active source cannot leave a line visible.

- [ ] **Step 9: Run focused chart lifecycle regressions**

Run:

```powershell
node --test --test-name-pattern="READY|token switch|resize boundary|full-canvas clear|narrow right-axis clear|disconnected|worker handoff|plot bounds|hint resolves" tests/markers.test.js tests/content-runtime.test.js
```

Expected: PASS. No stale route, generation, canvas, hint, or viewport can restore an old coordinate.

- [ ] **Step 10: Run complete verification and source checks**

Run:

```powershell
node --test tests/markers.test.js tests/content-runtime.test.js tests/gmgn-adapter.test.js tests/content-structure.test.js
npm.cmd test
npm.cmd run check
git diff --check
```

Expected: every command exits `0`, with no failing test, unhandled rejection, syntax error, or whitespace error.

- [ ] **Step 11: Build the extension and verify changed runtime parity**

Run:

```powershell
npm.cmd run build
$pairs = @(
  @('src\content\content.js', 'dist\tango-paper-trader\src\content\content.js'),
  @('src\content\chart-main.js', 'dist\tango-paper-trader\src\content\chart-main.js')
)
foreach ($pair in $pairs) {
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pair[0]).Hash
  $distHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pair[1]).Hash
  if ($sourceHash -ne $distHash) { throw "Source/dist mismatch: $($pair[0])" }
}
```

Expected: build exits `0`; both SHA-256 comparisons match exactly.

- [ ] **Step 12: Commit diagnostics, worker fail-closed behavior, and generated parity**

```powershell
git add src/content/chart-main.js tests/markers.test.js dist/tango-paper-trader/src/content/chart-main.js dist/tango-paper-trader/src/content/content.js
git commit -m "fix: fail closed when chart coordinates are unavailable"
```

After the final commit, verify `git diff -- src/content/markers.js` is empty and
inspect one parent delivery in the runtime test to confirm the canonical
`payload` still contains no frame-derived field.
