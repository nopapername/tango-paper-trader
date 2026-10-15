(function initTangoChartBridge() {
  if (window === window.top || window.__tangoPaperChartBridge) return;
  try {
    const frame = window.frameElement;
    const trustedContainer = frame?.closest?.('[data-sentry-component="TradingView"]');
    if (frame?.title && !['Financial Chart', 'TradingView'].includes(frame.title) && !trustedContainer) return;
  } catch { return; }
  window.__tangoPaperChartBridge = true;

  const SUBSCRIPT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
  const labelsByCanvas = new Map();
  const AXIS_LABEL_FRESH_MS = 1_500;
  const canvasIds = new WeakMap();
  const canvasRects = new WeakMap();
  const canvasClearedAt = new WeakMap();
  const canvasConsumedClearAt = new WeakMap();
  const workerOwnedCanvases = new WeakSet();
  let nextCanvasId = 1;
  let clearSequence = 0;
  let axisLabelSequence = 0;
  let markerAxisSequenceFloor = 0;
  let textCallSequence = 0;
  let frameContextTextFloor = 0;
  let lastScaleInvalidationReason = '';
  let markerState = null;
  let overlay = null;
  let lastScaleMode = null;
  let stableScale = null;
  let scaleUpdatedAt = 0;
  let stableSignature = '';
  let renderedSignature = '';
  const hiddenMarkerIds = new Set();
  const markerPositions = new Map();
  const markerElements = new Map();
  let axisRepaintQueued = false;
  const markerEconomicCoordinates = new Map();
  const CHART_AXIS_HINTS = new Set(['MARKET_CAP', 'PRICE', 'UNKNOWN']);
  const CHART_PROBE_ID_MAX_CHARS = 128;
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
  let observedFrameProbe = null;
  let activeFrameContext = null;
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

  function parseNumber(text) {
    const source = String(text || '').trim();
    const subscript = source.match(/0\.0([₀-₉])(\d+)/);
    if (subscript) return Number(`0.${'0'.repeat(Number(SUBSCRIPT[subscript[1]] || 0))}${subscript[2]}`);
    const cleaned = source.replaceAll(',', '').replace(/[^0-9eE.+\-KMBTkmbt]/g, '');
    const match = cleaned.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (!match) return 0;
    let value = Number(match[0]);
    const suffix = cleaned.slice(-1).toUpperCase();
    if (suffix === 'K') value *= 1e3;
    if (suffix === 'M') value *= 1e6;
    if (suffix === 'B') value *= 1e9;
    if (suffix === 'T') value *= 1e12;
    return Number.isFinite(value) ? value : 0;
  }

  function canvasId(canvas) {
    if (!canvasIds.has(canvas)) canvasIds.set(canvas, nextCanvasId++);
    return canvasIds.get(canvas);
  }

  function sourceBackingSignature(canvas) {
    const values = [Number(canvas?.width), Number(canvas?.height)];
    if (!values.every((number) => Number.isFinite(number) && number > 0)) return '';
    return values.map((number) => number.toFixed(2)).join(':');
  }

  function sourceObservationSignature(rect, canvas) {
    const backingStoreSignature = sourceBackingSignature(canvas);
    if (!backingStoreSignature) return '';
    const values = [
      Number(innerWidth),
      Number(innerHeight),
      Number(rect?.left),
      Number(rect?.top),
      Number(rect?.width),
      Number(rect?.height)
    ];
    if (!values.every(Number.isFinite)) return '';
    return `${values.map((number) => number.toFixed(2)).join(':')}:${backingStoreSignature}`;
  }

  function recordLabel(context, text, x, y) {
    textCallSequence += 1;
    if (workerOwnedCanvases.has(context?.canvas)) return;
    const value = parseNumber(text);
    if (!(value > 0) || !context?.canvas?.isConnected) return;
    const canvas = context.canvas;
    const cachedRect = canvasRects.get(canvas);
    const rect = cachedRect && Date.now() - cachedRect.updatedAt < 100 ? cachedRect.rect : canvas.getBoundingClientRect();
    if (!cachedRect || cachedRect.rect !== rect) canvasRects.set(canvas, { rect, updatedAt: Date.now() });
    if (rect.width < 20 || rect.height < 20) return;
    const rawX = Number(x);
    const rawY = Number(y);
    if (![rawX, rawY].every(Number.isFinite)) return;
    let point;
    try {
      const transform = context.getTransform();
      if (typeof transform?.transformPoint !== 'function') return;
      point = transform.transformPoint({ x: rawX, y: rawY });
    } catch { return; }
    if (![Number(point?.x), Number(point?.y)].every(Number.isFinite)) return;
    const clientX = rect.left + point.x * rect.width / Math.max(1, canvas.width);
    const clientY = rect.top + point.y * rect.height / Math.max(1, canvas.height);
    if (!(clientX > innerWidth - 180) || clientY < 35 || clientY > innerHeight - 55) return;
    const observedSourceSignature = sourceObservationSignature(rect, canvas);
    if (!observedSourceSignature) return;
    const id = canvasId(canvas);
    const clearedAt = canvasClearedAt.get(canvas) || 0;
    const entry = labelsByCanvas.get(id);
    let records = entry?.records || new Map();
    if (clearedAt && canvasConsumedClearAt.get(canvas) !== clearedAt) {
      records = new Map();
      canvasConsumedClearAt.set(canvas, clearedAt);
    }
    records.set(String(text), {
      text: String(text), value, y: clientY, x: clientX, id,
      generation: Number(clearedAt || 0), sequence: ++axisLabelSequence, updatedAt: Date.now(),
      sourceObservationSignature: observedSourceSignature
    });
    if (records.size > 100) {
      const oldest = [...records.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt).slice(0, records.size - 100);
      oldest.forEach(([key]) => records.delete(key));
    }
    labelsByCanvas.set(id, { canvas, records });
  }

  function clearsAxisSnapshot(context, x, y, width, height) {
    const canvas = context.canvas;
    const clearX = Number(x);
    const clearY = Number(y);
    const clearWidth = Number(width);
    const clearHeight = Number(height);
    const clearsMostCanvas = clearWidth * clearHeight > canvas.width * canvas.height * 0.45;
    if (clearsMostCanvas) return true;
    const canvasWidth = Number(canvas.width);
    const canvasHeight = Number(canvas.height);
    let transform;
    try {
      const { a, b, c, d, e, f } = context.getTransform();
      transform = { a, b, c, d, e, f };
    } catch { return false; }
    const hasFiniteBounds = [
      clearX, clearY, clearWidth, clearHeight, canvasWidth, canvasHeight,
      transform.a, transform.b, transform.c, transform.d, transform.e, transform.f
    ].every(Number.isFinite);
    if (!hasFiniteBounds || transform.b !== 0 || transform.c !== 0) return false;
    const transformedX1 = transform.a * clearX + transform.e;
    const transformedX2 = transform.a * (clearX + clearWidth) + transform.e;
    const transformedY1 = transform.d * clearY + transform.f;
    const transformedY2 = transform.d * (clearY + clearHeight) + transform.f;
    if (![transformedX1, transformedX2, transformedY1, transformedY2].every(Number.isFinite)) return false;
    const clearLeft = Math.min(transformedX1, transformedX2);
    const clearRight = Math.max(transformedX1, transformedX2);
    const clearTop = Math.min(transformedY1, transformedY2);
    const clearBottom = Math.max(transformedY1, transformedY2);
    const clippedVerticalCoverage = Math.max(0, Math.min(clearBottom, canvasHeight) - Math.max(clearTop, 0));
    const clearsRightAxis = canvasWidth > 0
      && canvasHeight > 0
      && clearWidth > 0
      && clearHeight > 0
      && clearLeft < canvasWidth
      && clearRight > 0
      && clippedVerticalCoverage >= canvasHeight * 0.7
      && clearRight >= canvasWidth * 0.8;
    return clearsRightAxis;
  }

  function invalidateCanvasSource(canvas, reason) {
    const id = canvasIds.get(canvas);
    const ownedRecords = id ? labelsByCanvas.get(id) : null;
    const ownedScale = Boolean(id && stableScale?.sourceId === id);
    const relevantUnselectedSource = !stableScale && Boolean(ownedRecords?.records?.size);
    const workerReplacedActiveRenderer = reason === 'WORKER_ONLY'
      && Boolean(stableScale || (axisRepaintQueued && overlay?.childElementCount));
    if (id) labelsByCanvas.delete(id);
    // Axis clears and replacement ticks normally arrive in one paint task.
    // Revalidate before the next paint instead of flashing an empty overlay.
    const deferOverlayClear = reason === 'STALE_GENERATION'
      && Boolean(overlay?.childElementCount)
      && typeof window.requestAnimationFrame === 'function';
    if (ownedScale || workerReplacedActiveRenderer) clearScaleAndPlacementCaches(deferOverlayClear);
    if (ownedScale || relevantUnselectedSource || workerReplacedActiveRenderer) {
      lastScaleInvalidationReason = reason;
      setChartDiagnostic(reason);
      if (deferOverlayClear && !axisRepaintQueued) {
        axisRepaintQueued = true;
        try {
          window.requestAnimationFrame(() => { axisRepaintQueued = false; renderMarkers(); });
        } catch {
          axisRepaintQueued = false;
          clearScaleAndPlacementCaches();
        }
      }
    }
  }

  const proto = window.CanvasRenderingContext2D?.prototype;
  if (proto) {
    const originalFillText = proto.fillText;
    const originalStrokeText = proto.strokeText;
    const originalClearRect = proto.clearRect;
    const originalFillRect = proto.fillRect;
    proto.fillText = function tangoFillText(text, x, y, ...rest) {
      recordLabel(this, text, x, y);
      return originalFillText.call(this, text, x, y, ...rest);
    };
    proto.strokeText = function tangoStrokeText(text, x, y, ...rest) {
      recordLabel(this, text, x, y);
      return originalStrokeText.call(this, text, x, y, ...rest);
    };
    proto.clearRect = function tangoClearRect(x, y, width, height) {
      if (this.canvas && clearsAxisSnapshot(this, x, y, width, height)) {
        const clearedAt = ++clearSequence;
        canvasClearedAt.set(this.canvas, clearedAt);
        canvasConsumedClearAt.set(this.canvas, clearedAt);
        invalidateCanvasSource(this.canvas, 'STALE_GENERATION');
      }
      return originalClearRect.call(this, x, y, width, height);
    };
    // TradingView also repaints an axis with a background fill. Those pixels
    // replace the old ticks just as a clear does; retaining them mixes scales.
    if (originalFillRect) proto.fillRect = function tangoFillRect(x, y, width, height) {
      if (this.canvas && clearsAxisSnapshot(this, x, y, width, height)) {
        const clearedAt = ++clearSequence;
        canvasClearedAt.set(this.canvas, clearedAt);
        canvasConsumedClearAt.set(this.canvas, clearedAt);
        invalidateCanvasSource(this.canvas, 'STALE_GENERATION');
      }
      return originalFillRect.call(this, x, y, width, height);
    };
  }

  const canvasProto = window.HTMLCanvasElement?.prototype;
  if (canvasProto?.transferControlToOffscreen) {
    const originalTransferControlToOffscreen = canvasProto.transferControlToOffscreen;
    canvasProto.transferControlToOffscreen = function tangoTransferControlToOffscreen(...args) {
      const result = originalTransferControlToOffscreen.apply(this, args);
      workerOwnedCanvases.add(this);
      markerAxisSequenceFloor = axisLabelSequence;
      frameContextTextFloor = textCallSequence;
      invalidateCanvasSource(this, 'WORKER_ONLY');
      return result;
    };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function linearFit(points, logarithmic) {
    const prepared = points.map((point) => ({ x: logarithmic ? Math.log(point.value) : point.value, y: point.y }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (prepared.length < 2) return null;
    const meanX = prepared.reduce((sum, point) => sum + point.x, 0) / prepared.length;
    const meanY = prepared.reduce((sum, point) => sum + point.y, 0) / prepared.length;
    const denominator = prepared.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
    if (!(denominator > 0)) return null;
    const slope = prepared.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator;
    const intercept = meanY - slope * meanX;
    const error = Math.sqrt(prepared.reduce((sum, point) => sum + (point.y - (slope * point.x + intercept)) ** 2, 0) / prepared.length);
    if (!(slope < 0)) return null;
    return { slope, intercept, error, logarithmic };
  }

  function robustFit(points, logarithmic) {
    const prepared = points.map((point) => ({ point, x: logarithmic ? Math.log(point.value) : point.value, y: point.y }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (prepared.length < 3) return null;
    const slopes = [];
    for (let left = 0; left < prepared.length; left += 1) {
      for (let right = left + 1; right < prepared.length; right += 1) {
        const deltaX = prepared[right].x - prepared[left].x;
        if (Math.abs(deltaX) > Number.EPSILON) slopes.push((prepared[right].y - prepared[left].y) / deltaX);
      }
    }
    const slope = median(slopes);
    if (!(slope < 0)) return null;
    const intercept = median(prepared.map((point) => point.y - slope * point.x));
    const residuals = prepared.map((point) => Math.abs(point.y - (slope * point.x + intercept)));
    const tolerance = Math.max(2.5, median(residuals) * 2.8);
    const inliers = prepared
      .filter((point) => Math.abs(point.y - (slope * point.x + intercept)) <= tolerance)
      .map((point) => point.point);
    const fit = inliers.length >= 3 ? linearFit(inliers, logarithmic) : null;
    return fit ? { ...fit, inliers } : null;
  }

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
    let plotRect = sourceRect;
    const axis = canvas.parentElement;
    if (axis?.matches?.('.price-axis[data-name]')) {
      const axisContainer = axis.parentElement;
      if (!axisContainer?.matches?.('.price-axis-container')) return null;
      const panes = Array.from(axisContainer.parentElement?.children || [])
        .filter((node) => node.matches?.('[data-qa-id="pane"]'));
      if (panes.length !== 1) return null;
      const plotWrappers = Array.from(panes[0].querySelectorAll?.('[data-qa-id="pane-widget-chart-gui-wrapper"]') || []);
      if (plotWrappers.length !== 1) return null;
      plotRect = finiteRect(plotWrappers[0]);
      if (!plotRect || plotRect.width <= sourceRect.width
        || Math.abs(plotRect.right - sourceRect.left) > 2
        || Math.abs(plotRect.top - sourceRect.top) > 2
        || Math.abs(plotRect.bottom - sourceRect.bottom) > 2) return null;
    }
    const plotBounds = {
      left: Math.max(0, plotRect.left),
      right: Math.min(viewport.width, plotRect.right, Math.min(...xs)),
      top: Math.max(0, plotRect.top, Math.min(...ys) - tickSpacing),
      bottom: Math.min(viewport.height, plotRect.bottom, Math.max(...ys) + tickSpacing)
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
    if (sourceBackingSignature(entry.canvas) !== scale.backingStoreSignature) return false;
    const current = currentSourceGeometry(entry.canvas, scale.points, scale.tickSpacing);
    return geometrySignature(current) === scale.geometrySignature;
  }

  function selectScale(visibleMarkers = markerState?.markers || []) {
    if (!markerState) return null;
    const postContextTextCalls = textCallSequence - frameContextTextFloor;
    const postContextNumericLabels = axisLabelSequence - markerAxisSequenceFloor;
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
    const postBoundaryPoints = [...labelsByCanvas.values()]
      .flatMap((entry) => [...entry.records.values()])
      .filter((point) => Number(point.sequence || 0) > markerAxisSequenceFloor);
    if (lastScaleInvalidationReason === 'WORKER_ONLY' && !postBoundaryPoints.length) {
      setChartDiagnostic('WORKER_ONLY');
      return null;
    }
    if (postBoundaryPoints.length < 3
      || new Set(postBoundaryPoints.map((point) => point.value)).size < 3) {
      setChartDiagnostic(markerAxisSequenceFloor > 0 && postBoundaryPoints.length === 0
        ? 'STALE_GENERATION'
        : 'TOO_FEW_ANCHORS');
      return null;
    }
    const now = Date.now();
    const groups = [...labelsByCanvas.entries()].flatMap(([sourceId, entry]) => {
      const currentRect = finiteRect(entry.canvas);
      const currentObservationSignature = sourceObservationSignature(currentRect, entry.canvas);
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
        const fit = !linear ? logarithmic : !logarithmic ? linear : linear.error <= logarithmic.error ? linear : logarithmic;
        const points = fit?.inliers || [];
        const tickSpacing = median(points.slice(1)
          .map((point, index) => Math.abs(point.y - points[index].y)));
        if (!fit || fit.error > Math.max(4, tickSpacing * 0.18)) return { ...group, fit: null };
        // Unit selection and plot bounds must use the same accepted ticks as
        // the fit, rather than volume/current-price badges rejected as outliers.
        const geometry = currentSourceGeometry(group.canvas, points, tickSpacing);
        return { ...group, points, fit, tickSpacing, geometry };
      }).filter((group) => group.fit && group.geometry);
    if (!groups.length) {
      setChartDiagnostic('REJECTED_FIT');
      return null;
    }
    const quoteUsd = Number(activeFrameContext?.quoteUsd ?? 1);
    if (!(quoteUsd > 0)) {
      setChartDiagnostic('REJECTED_MODE');
      return null;
    }
    const modes = [];
    const addPriceMode = (value) => {
      if (Number(value) > 0) modes.push({ type: 'PRICE', factor: 1, current: Number(value) / quoteUsd });
    };
    const addMarketCapModes = (value) => {
      if (Number(value) > 0) {
        [1, 1e3, 1e6, 1e9].forEach((factor) => modes.push({
          type: 'MARKET_CAP', factor, current: Number(value) / factor / quoteUsd
        }));
      }
    };
    const axisHint = activeFrameContext?.axisHint || 'UNKNOWN';
    const permitPrice = axisHint !== 'MARKET_CAP';
    const permitMarketCap = axisHint !== 'PRICE';
    if (permitPrice) addPriceMode(markerState.currentPrice);
    if (permitMarketCap) addMarketCapModes(markerState.currentMarketCap);
    visibleMarkers.forEach((marker) => {
      if (permitPrice) addPriceMode(marker.price);
      if (permitMarketCap) addMarketCapModes(marker.marketCap);
    });
    if (!modes.length) {
      setChartDiagnostic('REJECTED_MODE');
      stableScale = null;
      stableSignature = '';
      return null;
    }
    const candidates = [];
    groups.forEach(({ sourceId, canvas, points, fit, tickSpacing, geometry }) => modes.forEach((mode) => {
      const nearest = Math.min(...points.map((point) => Math.abs(Math.log(point.value / mode.current))));
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
        backingStoreSignature: sourceBackingSignature(canvas),
        geometrySignature: geometrySignature(geometry),
        axisGeneration: Math.max(...points.map((point) => Number(point.generation || 0))),
        observedAt: Math.max(...points.map((point) => Number(point.updatedAt || 0))),
        fitError: fit.error,
        score
      });
    }));
    const best = candidates.sort((a, b) => a.score - b.score)[0];
    if (!best || best.score >= 1.6) {
      setChartDiagnostic('REJECTED_MODE');
      stableScale = null;
      stableSignature = '';
      return null;
    }
    const previous = lastScaleMode && candidates.find((candidate) =>
      candidate.type === lastScaleMode.type && candidate.factor === lastScaleMode.factor && candidate.score < 1.6
    );
    const selected = previous && previous.score <= best.score + 0.28 ? previous : best;
    lastScaleMode = { type: selected.type, factor: selected.factor };
    const selectedWithContext = {
      ...selected,
      quoteUsd,
      axisHint,
      frameGeneration: activeFrameContext.frameGeneration,
      probeId: activeFrameContext.probeId
    };
    const signature = JSON.stringify([
      selectedWithContext.frameGeneration,
      selectedWithContext.probeId,
      axisHint,
      quoteUsd,
      selected.type,
      selected.factor,
      selected.sourceId,
      selected.axisGeneration,
      selected.backingStoreSignature,
      selected.geometrySignature,
      selected.fit.logarithmic,
      selected.fit.slope,
      selected.fit.intercept,
      selected.points.map((point) => [point.x, point.y, point.value])
    ]);
    const sameMode = stableScale?.type === selected.type
      && stableScale?.factor === selected.factor
      && stableScale?.frameGeneration === selectedWithContext.frameGeneration
      && stableScale?.probeId === selectedWithContext.probeId
      && stableScale?.axisHint === axisHint
      && stableScale?.quoteUsd === quoteUsd;
    if (sameMode && stableSignature === signature) return stableScale;
    stableScale = selectedWithContext;
    stableSignature = signature;
    scaleUpdatedAt = Date.now();
    return stableScale;
  }

  function compactUsd(value) {
    const number = Number(value || 0);
    if (!(number > 0)) return '--';
    if (number >= 1e9) return `$${(number / 1e9).toFixed(2)}B`;
    if (number >= 1e6) return `$${(number / 1e6).toFixed(2)}M`;
    if (number >= 1e3) return `$${(number / 1e3).toFixed(2)}K`;
    if (number >= 1) return `$${number.toFixed(4)}`;
    return `$${number.toPrecision(4)}`;
  }

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;
    markerElements.clear();
    overlay = document.createElement('div');
    overlay.id = 'tango-chart-axis-markers';
    Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147482000' });
    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  let lastDiagnosticKey = ''; let lastDiagnosticAt = 0;
  function renderMarkers() {
    if (document.hidden) return;
    try {
      renderMarkerOverlay();
    } finally {
      if (overlay?.isConnected) {
        const markers = markerState?.markers || [];
        const visibleCount = markers.filter((marker) => !hiddenMarkerIds.has(marker.id)).length;
        const reason = !markers.length ? 'EMPTY_MARKERS'
          : !visibleCount ? 'HIDDEN'
            : !frameContextMatchesObservedProbe(activeFrameContext) ? 'FRAME_CONTEXT_MISMATCH'
              : chartDiagnostic.reason;
        const diagnosticKey = [reason, markers.length, visibleCount, overlay.childElementCount,
          axisLabelSequence, markerAxisSequenceFloor, chartDiagnostic.axisHint,
          chartDiagnostic.frameGeneration].join(':');
        const now = Date.now();
        if (diagnosticKey !== lastDiagnosticKey || now - lastDiagnosticAt >= 1000 || now < lastDiagnosticAt) {
        // Diagnostic sampling has its own cadence; rendering and invalidation stay immediate.
        overlay.setAttribute('data-tango-chart-diagnostic', JSON.stringify({
          reason,
          markerCount: markers.length,
          visibleCount,
          renderedCount: overlay.childElementCount,
          anchorCount: [...labelsByCanvas.values()].reduce((sum, entry) => sum + entry.records.size, 0),
          axisSequence: axisLabelSequence,
          axisSequenceFloor: markerAxisSequenceFloor,
          axisHint: chartDiagnostic.axisHint,
          frameGeneration: chartDiagnostic.frameGeneration,
          sources: [...labelsByCanvas.values()].slice(0, 4).map((entry) => {
            const rect = finiteRect(entry.canvas);
            const observationSignature = sourceObservationSignature(rect, entry.canvas);
            return {
              rect,
              backingWidth: Number(entry.canvas.width),
              backingHeight: Number(entry.canvas.height),
              clearedGeneration: Number(canvasClearedAt.get(entry.canvas) || 0),
              points: [...entry.records.values()].slice(-100).map((point) => ({
                value: point.value, x: point.x, y: point.y,
                generation: point.generation, sequence: point.sequence,
                ageMs: Math.max(0, Date.now() - point.updatedAt),
                currentGeometry: point.sourceObservationSignature === observationSignature
              }))
            };
          })
        }));
        lastDiagnosticKey = diagnosticKey; lastDiagnosticAt = now;
        }
      }
    }
  }

  function renderMarkerOverlay() {
    discardDisconnectedCanvasRecords();
    const root = ensureOverlay();
    const markers = markerState?.markers || [];
    const markerIds = new Set(markers.map((marker) => marker.id));
    markerPositions.forEach((_, id) => {
      if (!markerIds.has(id)) markerPositions.delete(id);
    });
    markerEconomicCoordinates.forEach((_, id) => {
      if (!markerIds.has(id)) markerEconomicCoordinates.delete(id);
    });
    const visibleMarkers = markers.filter((marker) => !hiddenMarkerIds.has(marker.id));
    if (!visibleMarkers.length) {
      if (root.childElementCount) root.replaceChildren();
      markerElements.clear();
      renderedSignature = '';
      return;
    }
    if (!frameContextMatchesObservedProbe(activeFrameContext)) {
      if (root.childElementCount) root.replaceChildren();
      markerElements.clear();
      renderedSignature = '';
      return;
    }
    if (stableScale && !scaleGeometryIsCurrent(stableScale)) {
      markerAxisSequenceFloor = axisLabelSequence;
      lastScaleInvalidationReason = 'VIEWPORT_CHANGED';
      setChartDiagnostic('VIEWPORT_CHANGED');
      clearScaleAndPlacementCaches();
      return;
    }
    const scale = selectScale(visibleMarkers);
    if (!scale) {
      if (root.childElementCount) root.replaceChildren();
      markerElements.clear();
      renderedSignature = '';
      return;
    }
    if (!scaleGeometryIsCurrent(scale)) {
      markerAxisSequenceFloor = axisLabelSequence;
      lastScaleInvalidationReason = 'VIEWPORT_CHANGED';
      setChartDiagnostic('VIEWPORT_CHANGED');
      clearScaleAndPlacementCaches();
      return;
    }
    const nextSignature = `${stableSignature}:${innerWidth}:${innerHeight}:${visibleMarkers.map((marker) =>
      `${marker.id}:${marker.side}:${marker.marketCap}:${marker.price}:${marker.label}:${marker.closeLabel || ''}`).join('|')}`;
    if (renderedSignature === nextSignature) return;
    const nodes = [];
    const nextElements = new Map();
    const occurrences = new Map();
    visibleMarkers.forEach((marker) => {
      const rawValue = scale.type === 'MARKET_CAP'
        ? Number(marker.marketCap) / scale.factor / scale.quoteUsd
        : Number(marker.price) / scale.quoteUsd;
      if (!(rawValue > 0)) return;
      const fitX = scale.fit.logarithmic ? Math.log(rawValue) : rawValue;
      const targetY = scale.fit.slope * fitX + scale.fit.intercept;
      if (!Number.isFinite(targetY)
        || targetY < scale.plotBounds.top
        || targetY > scale.plotBounds.bottom) {
        setChartDiagnostic('OUT_OF_PLOT');
        return;
      }
      const previousY = markerPositions.get(marker.id);
      const placementContext = [
        scale.type,
        scale.factor,
        scale.frameGeneration,
        scale.probeId,
        scale.sourceId,
        scale.axisGeneration,
        scale.backingStoreSignature,
        scale.geometrySignature,
        rawValue
      ].join(':');
      const sameEconomicCoordinate = markerEconomicCoordinates.get(marker.id) === placementContext;
      const y = sameEconomicCoordinate
        && Number.isFinite(previousY)
        && Math.abs(previousY - targetY) < 3
        ? previousY
        : targetY;
      markerPositions.set(marker.id, y);
      markerEconomicCoordinates.set(marker.id, placementContext);
      const occurrence = occurrences.get(marker.id) || 0;
      occurrences.set(marker.id, occurrence + 1);
      const elementKey = JSON.stringify([marker.id, occurrence]);
      const existing = markerElements.get(elementKey);
      const line = existing?.line || document.createElement('div');
      const color = marker.side === 'SELL' ? '#ff6673' : '#42e797';
      Object.assign(line.style, {
        borderTop: `1px dashed ${color}`,
        color,
        left: `${Math.round(scale.plotBounds.left)}px`,
        position: 'fixed',
        right: `${Math.max(0, Math.round(innerWidth - scale.plotBounds.right))}px`,
        top: `${Math.round(y)}px`,
        opacity: '.94'
      });
      const label = existing?.label || document.createElement('span');
      Object.assign(label.style, {
        background: 'rgba(12,13,18,.95)', border: `1px solid ${color}`, borderRadius: '5px', color,
        alignItems: 'center', display: 'flex', font: '800 10px/1.2 Inter,system-ui,sans-serif', gap: '5px',
        padding: '3px 4px 3px 6px', pointerEvents: 'auto', position: 'absolute', right: '5px', top: '-11px', whiteSpace: 'nowrap'
      });
      const text = existing?.text || document.createElement('span');
      const nextText = `${marker.label} · ${compactUsd(scale.type === 'MARKET_CAP' ? marker.marketCap : marker.price)}`;
      if (text.textContent !== nextText) text.textContent = nextText;
      const close = existing?.close || document.createElement('button');
      close.type = 'button';
      if (!existing) close.textContent = '×';
      close.title = marker.closeLabel || 'Hide line';
      close.setAttribute('aria-label', close.title);
      Object.assign(close.style, {
        appearance: 'none', background: 'rgba(255,255,255,.08)', border: '0', borderRadius: '3px', color,
        cursor: 'pointer', font: '900 12px/14px Inter,system-ui,sans-serif', height: '15px', padding: '0', width: '15px'
      });
      if (!existing) {
        close.addEventListener('pointerdown', (event) => event.stopPropagation());
        close.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          hiddenMarkerIds.add(marker.id);
          renderMarkers();
        });
        label.append(text, close);
        line.appendChild(label);
      }
      nextElements.set(elementKey, { line, label, text, close });
      nodes.push(line);
    });
    markerElements.clear();
    nextElements.forEach((elements, key) => markerElements.set(key, elements));
    const currentNodes = Array.from(root.children);
    if (currentNodes.length !== nodes.length || nodes.some((node, index) => currentNodes[index] !== node)) {
      root.replaceChildren(...nodes);
    }
    renderedSignature = nextSignature;
    if (nodes.length) {
      lastScaleInvalidationReason = '';
      setChartDiagnostic('RENDERED');
    }
  }

  const supportedTokenChains = new Set(['sol', 'eth', 'bsc', 'base', 'robinhood', 'xlayer']);
  const evmTokenChains = new Set(['eth', 'bsc', 'base', 'robinhood', 'xlayer']);
  const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function decodedBase58Length(value) {
    const bytes = [0];
    for (const character of value) {
      let carry = base58Alphabet.indexOf(character);
      if (carry < 0) return -1;
      for (let index = 0; index < bytes.length; index += 1) {
        carry += bytes[index] * 58;
        bytes[index] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    let leadingZeroBytes = 0;
    while (value[leadingZeroBytes] === '1') leadingZeroBytes += 1;
    const significantBytes = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
    return leadingZeroBytes + significantBytes;
  }

  function normalizedTokenIdentity(chainValue, addressValue) {
    const chain = String(chainValue || '').trim().toLowerCase();
    const address = String(addressValue || '').trim();
    if (!supportedTokenChains.has(chain) || !address) return null;
    if (evmTokenChains.has(chain)) {
      return /^0x[a-fA-F0-9]{40}$/.test(address)
        ? { chain, address: address.toLowerCase() }
        : null;
    }
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
      && decodedBase58Length(address) === 32
      ? { chain, address }
      : null;
  }

  function validMarker(marker) {
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false;
    const validText = (value) => typeof value === 'string' && value.trim().length > 0;
    const validCoordinate = (value) => typeof value === 'number'
      && Number.isFinite(value) && value >= 0;
    return validText(marker.id)
      && ['BUY', 'SELL'].includes(marker.side)
      && validCoordinate(marker.marketCap)
      && validCoordinate(marker.price)
      && (marker.marketCap > 0 || marker.price > 0)
      && validText(marker.label)
      && (!Object.prototype.hasOwnProperty.call(marker, 'closeLabel')
        || validText(marker.closeLabel));
  }

  function tokenIdentityFromUrl(value) {
    let parsed;
    try { parsed = new URL(value); } catch { return null; }
    const parts = parsed.pathname.split('/').filter(Boolean);
    let chain = '';
    let address = '';
    const tokenIndex = parts.findIndex((part) => part.toLowerCase() === 'token');
    if (tokenIndex > 0 && tokenIndex + 1 < parts.length) {
      chain = parts[tokenIndex - 1].toLowerCase();
      try { address = decodeURIComponent(parts[tokenIndex + 1]); } catch { return null; }
    } else {
      chain = String(parsed.searchParams.get('chain') || parsed.searchParams.get('network') || '').toLowerCase();
      address = String(
        parsed.searchParams.get('address') || parsed.searchParams.get('tokenAddress')
        || parsed.searchParams.get('token_address') || parsed.searchParams.get('token')
        || parsed.searchParams.get('mint') || parsed.searchParams.get('ca') || ''
      );
    }
    return normalizedTokenIdentity(chain, address);
  }

  function childTokenIdentity() {
    const direct = tokenIdentityFromUrl(window.location.href);
    if (direct) return direct;
    let topHref;
    try { topHref = window.top.location.href; } catch { return null; }
    let topUrl;
    try { topUrl = new URL(topHref); } catch {}
    if (topUrl?.protocol === 'https:' && topUrl.hostname.toLowerCase() === 'gmgn.ai') {
      const topIdentity = tokenIdentityFromUrl(topUrl.href);
      if (topIdentity) return topIdentity;
    }
    let referrer;
    try { referrer = new URL(document.referrer); } catch { return null; }
    if (referrer.protocol !== 'https:' || referrer.hostname.toLowerCase() !== 'gmgn.ai') return null;
    return tokenIdentityFromUrl(referrer.href);
  }

  function normalizedFrameContext(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!CHART_AXIS_HINTS.has(value.axisHint)) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'quoteCurrency')
      && !['USD', 'SOL', 'ETH', 'BNB', 'OKB', 'UNKNOWN'].includes(value.quoteCurrency)) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'quoteUsd')
      && (typeof value.quoteUsd !== 'number' || !Number.isFinite(value.quoteUsd) || value.quoteUsd < 0)) return null;
    if (!Number.isSafeInteger(value.frameGeneration) || value.frameGeneration <= 0) return null;
    if (typeof value.probeId !== 'string'
      || !value.probeId
      || value.probeId.length > CHART_PROBE_ID_MAX_CHARS) return null;
    return {
      axisHint: value.axisHint,
      ...(Object.prototype.hasOwnProperty.call(value, 'quoteCurrency') ? { quoteCurrency: value.quoteCurrency } : {}),
      ...(Object.prototype.hasOwnProperty.call(value, 'quoteUsd') ? { quoteUsd: value.quoteUsd } : {}),
      frameGeneration: value.frameGeneration,
      probeId: value.probeId
    };
  }

  function clearScaleAndPlacementCaches(preserveOverlayUntilPaint = false) {
    lastScaleMode = null;
    stableScale = null;
    stableSignature = '';
    renderedSignature = '';
    markerPositions.clear();
    markerEconomicCoordinates.clear();
    if (!preserveOverlayUntilPaint) {
      markerElements.clear();
      if (overlay?.childElementCount) overlay.replaceChildren();
    }
  }

  function applyFrameContext(next) {
    if (!next) return false;
    if (activeFrameContext && next.frameGeneration < activeFrameContext.frameGeneration) return false;
    const changed = Boolean(activeFrameContext) && (
      next.frameGeneration !== activeFrameContext.frameGeneration
      || next.probeId !== activeFrameContext.probeId
      || next.axisHint !== activeFrameContext.axisHint
      || (next.quoteCurrency ?? 'USD') !== (activeFrameContext.quoteCurrency ?? 'USD')
    );
    if (changed) {
      markerAxisSequenceFloor = axisLabelSequence;
      frameContextTextFloor = textCallSequence;
      clearScaleAndPlacementCaches();
    }
    if (!changed && activeFrameContext
      && (next.quoteUsd ?? 1) !== (activeFrameContext.quoteUsd ?? 1)) {
      clearScaleAndPlacementCaches();
    }
    activeFrameContext = next;
    return true;
  }

  function observeFrameProbe(probeId, frameGeneration) {
    if (typeof probeId !== 'string'
      || !probeId
      || probeId.length > CHART_PROBE_ID_MAX_CHARS
      || !Number.isSafeInteger(frameGeneration)
      || frameGeneration <= 0
      || (observedFrameProbe && frameGeneration < observedFrameProbe.frameGeneration)) {
      return false;
    }
    if (observedFrameProbe?.probeId === probeId
      && observedFrameProbe.frameGeneration === frameGeneration) return true;
    if (observedFrameProbe) {
      markerAxisSequenceFloor = axisLabelSequence;
      frameContextTextFloor = textCallSequence;
      activeFrameContext = null;
      clearScaleAndPlacementCaches();
      setChartDiagnostic('IDLE');
    }
    observedFrameProbe = { probeId, frameGeneration };
    return true;
  }

  function frameContextMatchesObservedProbe(context) {
    return Boolean(context
      && observedFrameProbe
      && context.probeId === observedFrameProbe.probeId
      && context.frameGeneration === observedFrameProbe.frameGeneration);
  }

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

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent
      || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)
      || event.data.source !== 'TANGO_PAPER_PARENT') return;
    if (event.data.type === 'CHART_READY_PROBE') {
      const probeId = typeof event.data.probeId === 'string' ? event.data.probeId : '';
      const frameGeneration = event.data.frameGeneration;
      if (observeFrameProbe(probeId, frameGeneration)) {
        announceReady(probeId, frameGeneration);
      }
      return;
    }
    if (event.data.type !== 'CHART_MARKERS') return;
    const payload = event.data.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !Array.isArray(payload.markers)
      || payload.markers.some((marker) => !validMarker(marker))) {
      return;
    }
    const hasChainField = Object.prototype.hasOwnProperty.call(payload, 'chain');
    const hasAddressField = Object.prototype.hasOwnProperty.call(payload, 'tokenAddress');
    let nextState = payload;
    if (hasChainField || hasAddressField) {
      const payloadIdentity = normalizedTokenIdentity(payload.chain, payload.tokenAddress);
      const childIdentity = childTokenIdentity();
      if (!payloadIdentity || !childIdentity
        || payloadIdentity.chain !== childIdentity.chain
        || payloadIdentity.address !== childIdentity.address) return;
      nextState = { ...payload, chain: payloadIdentity.chain, tokenAddress: payloadIdentity.address };
    } else if (payload.markers.length || Object.keys(payload).length !== 1) return;
    const nextFrameContext = normalizedFrameContext(event.data.context);
    if (!frameContextMatchesObservedProbe(nextFrameContext)) return;
    if (!applyFrameContext(nextFrameContext)) return;
    const hasTokenIdentity = (state) => Boolean(state?.chain && state?.tokenAddress);
    const identityChanged = hasTokenIdentity(markerState)
      && hasTokenIdentity(nextState)
      && (markerState?.chain !== nextState?.chain || markerState?.tokenAddress !== nextState?.tokenAddress);
    const clearsIdentifiedToken = hasTokenIdentity(markerState) && !nextState?.markers?.length;
    if (identityChanged || clearsIdentifiedToken) markerAxisSequenceFloor = axisLabelSequence;
    if (!nextState?.markers?.length
      || identityChanged) {
      clearScaleAndPlacementCaches();
      hiddenMarkerIds.clear();
    }
    markerState = nextState;
    renderMarkers();
  });
  announceReady();
  window.addEventListener('resize', () => {
    markerAxisSequenceFloor = axisLabelSequence;
    stableScale = null;
    stableSignature = '';
    renderedSignature = '';
    markerPositions.clear();
    markerEconomicCoordinates.clear();
    renderMarkers();
  }, { passive: true });
  document.addEventListener?.('visibilitychange', () => { if (!document.hidden) renderMarkers(); });
  setInterval(renderMarkers, 400);
})();
