(function initTangoChartBridge() {
  if (window === window.top || window.__tangoPaperChartBridge) return;
  try {
    if (window.frameElement?.title && window.frameElement.title !== 'Financial Chart') return;
  } catch {}
  window.__tangoPaperChartBridge = true;

  const SUBSCRIPT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
  const labelsByCanvas = new Map();
  const canvasIds = new WeakMap();
  const canvasRects = new WeakMap();
  let nextCanvasId = 1;
  let markerState = null;
  let overlay = null;
  let lastScaleMode = null;
  let stableScale = null;
  let scaleUpdatedAt = 0;
  let stableSignature = '';
  const hiddenMarkerIds = new Set();
  const markerPositions = new Map();

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

  function recordLabel(context, text, x, y) {
    const value = parseNumber(text);
    if (!(value > 0) || !context?.canvas?.isConnected) return;
    const canvas = context.canvas;
    const cachedRect = canvasRects.get(canvas);
    const rect = cachedRect && Date.now() - cachedRect.updatedAt < 100 ? cachedRect.rect : canvas.getBoundingClientRect();
    if (!cachedRect || cachedRect.rect !== rect) canvasRects.set(canvas, { rect, updatedAt: Date.now() });
    if (rect.width < 20 || rect.height < 20) return;
    let point = { x: Number(x), y: Number(y) };
    try {
      const transform = context.getTransform();
      point = transform.transformPoint({ x: Number(x), y: Number(y) });
    } catch {}
    const clientX = rect.left + point.x * rect.width / Math.max(1, canvas.width);
    const clientY = rect.top + point.y * rect.height / Math.max(1, canvas.height);
    if (!(clientX > innerWidth - 180) || clientY < 35 || clientY > innerHeight - 55) return;
    const id = canvasId(canvas);
    const records = labelsByCanvas.get(id) || new Map();
    records.set(String(text), {
      text: String(text), value, y: clientY, x: clientX, id, updatedAt: Date.now()
    });
    if (records.size > 100) {
      const oldest = [...records.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt).slice(0, records.size - 100);
      oldest.forEach(([key]) => records.delete(key));
    }
    labelsByCanvas.set(id, records);
  }

  const proto = window.CanvasRenderingContext2D?.prototype;
  if (proto) {
    const originalFillText = proto.fillText;
    const originalStrokeText = proto.strokeText;
    const originalClearRect = proto.clearRect;
    proto.fillText = function tangoFillText(text, x, y, ...rest) {
      recordLabel(this, text, x, y);
      return originalFillText.call(this, text, x, y, ...rest);
    };
    proto.strokeText = function tangoStrokeText(text, x, y, ...rest) {
      recordLabel(this, text, x, y);
      return originalStrokeText.call(this, text, x, y, ...rest);
    };
    proto.clearRect = function tangoClearRect(x, y, width, height) {
      return originalClearRect.call(this, x, y, width, height);
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
    return inliers.length >= 3 ? linearFit(inliers, logarithmic) : null;
  }

  function selectScale() {
    if (!markerState) return null;
    const groups = [...labelsByCanvas.values()].map((records) => [...records.values()])
      .map((points) => {
        const deduped = new Map();
        points.filter((point) => Date.now() - point.updatedAt < 2_500).forEach((point) => deduped.set(Math.round(point.y / 2) * 2, point));
        return [...deduped.values()].sort((a, b) => a.y - b.y);
      }).filter((points) => points.length >= 3 && new Set(points.map((point) => point.value)).size >= 3);
    const modes = [];
    if (Number(markerState.currentPrice) > 0) modes.push({ type: 'PRICE', factor: 1, current: Number(markerState.currentPrice) });
    if (Number(markerState.currentMarketCap) > 0) {
      [1, 1e3, 1e6, 1e9].forEach((factor) => modes.push({ type: 'MARKET_CAP', factor, current: Number(markerState.currentMarketCap) / factor }));
    }
    const candidates = [];
    groups.forEach((points) => modes.forEach((mode) => {
      const nearest = Math.min(...points.map((point) => Math.abs(Math.log(point.value / mode.current))));
      const linear = robustFit(points, false);
      const logarithmic = robustFit(points, true);
      const fit = !linear ? logarithmic : !logarithmic ? linear : linear.error <= logarithmic.error ? linear : logarithmic;
      if (!fit) return;
      const span = Math.max(1, points.at(-1).y - points[0].y);
      const score = nearest + Math.min(2, fit.error / span * 8);
      candidates.push({ ...mode, points, fit, score });
    }));
    const best = candidates.sort((a, b) => a.score - b.score)[0];
    if (!best || best.score >= 1.6) return null;
    const previous = lastScaleMode && candidates.find((candidate) =>
      candidate.type === lastScaleMode.type && candidate.factor === lastScaleMode.factor && candidate.score < 1.6
    );
    const selected = previous && previous.score <= best.score + 0.28 ? previous : best;
    lastScaleMode = { type: selected.type, factor: selected.factor };
    const signature = `${selected.type}:${selected.factor}:${selected.points.map((point) => `${Math.round(point.y / 3)}:${Number(point.value).toPrecision(5)}`).join('|')}`;
    const sameMode = stableScale?.type === selected.type && stableScale?.factor === selected.factor;
    if (sameMode && stableSignature === signature) return stableScale;
    if (sameMode && Date.now() - scaleUpdatedAt < 500) return stableScale;
    stableScale = selected;
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
    overlay = document.createElement('div');
    overlay.id = 'tango-chart-axis-markers';
    Object.assign(overlay.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147482000' });
    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  function renderMarkers() {
    const root = ensureOverlay();
    const visibleMarkers = (markerState?.markers || []).filter((marker) => !hiddenMarkerIds.has(marker.id));
    if (!visibleMarkers.length) {
      root.replaceChildren();
      return;
    }
    const scale = selectScale();
    if (!scale) {
      root.replaceChildren();
      return;
    }
    const nodes = [];
    visibleMarkers.forEach((marker) => {
      const rawValue = scale.type === 'MARKET_CAP'
        ? Number(marker.marketCap || 0) / scale.factor
        : Number(marker.price || (markerState.currentPrice * Number(marker.marketCap || 0) / markerState.currentMarketCap) || 0);
      if (!(rawValue > 0)) return;
      const fitX = scale.fit.logarithmic ? Math.log(rawValue) : rawValue;
      const targetY = scale.fit.slope * fitX + scale.fit.intercept;
      if (!Number.isFinite(targetY) || targetY < 35 || targetY > innerHeight - 55) return;
      const previousY = markerPositions.get(marker.id);
      const y = Number.isFinite(previousY) && Math.abs(previousY - targetY) < 3 ? previousY : targetY;
      markerPositions.set(marker.id, y);
      const line = document.createElement('div');
      const color = marker.side === 'SELL' ? '#ff6673' : '#42e797';
      Object.assign(line.style, {
        borderTop: `1px dashed ${color}`, color, left: '0', position: 'fixed', right: '58px', top: `${Math.round(y)}px`, opacity: '.94'
      });
      const label = document.createElement('span');
      Object.assign(label.style, {
        background: 'rgba(12,13,18,.95)', border: `1px solid ${color}`, borderRadius: '5px', color,
        alignItems: 'center', display: 'flex', font: '800 10px/1.2 Inter,system-ui,sans-serif', gap: '5px',
        padding: '3px 4px 3px 6px', pointerEvents: 'auto', position: 'absolute', right: '5px', top: '-11px', whiteSpace: 'nowrap'
      });
      const text = document.createElement('span');
      text.textContent = `${marker.label} · ${compactUsd(scale.type === 'MARKET_CAP' ? marker.marketCap : rawValue)}`;
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.title = marker.closeLabel || 'Hide line';
      close.setAttribute('aria-label', close.title);
      Object.assign(close.style, {
        appearance: 'none', background: 'rgba(255,255,255,.08)', border: '0', borderRadius: '3px', color,
        cursor: 'pointer', font: '900 12px/14px Inter,system-ui,sans-serif', height: '15px', padding: '0', width: '15px'
      });
      close.addEventListener('pointerdown', (event) => event.stopPropagation());
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        hiddenMarkerIds.add(marker.id);
        renderMarkers();
      });
      label.append(text, close);
      line.appendChild(label);
      nodes.push(line);
    });
    root.replaceChildren(...nodes);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'TANGO_PAPER_PARENT' || event.data?.type !== 'CHART_MARKERS') return;
    const nextState = event.data.payload || null;
    if (markerState?.tokenAddress !== nextState?.tokenAddress) {
      lastScaleMode = null;
      stableScale = null;
      stableSignature = '';
      hiddenMarkerIds.clear();
      markerPositions.clear();
    }
    markerState = nextState;
    renderMarkers();
  });
  window.addEventListener('resize', () => {
    stableScale = null;
    stableSignature = '';
    markerPositions.clear();
    renderMarkers();
  }, { passive: true });
  setInterval(renderMarkers, 400);
})();
