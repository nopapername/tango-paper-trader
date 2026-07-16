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
    records.set(`${String(text)}:${Math.round(clientY)}`, {
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
      if (this.canvas && Number(width) * Number(height) > this.canvas.width * this.canvas.height * 0.45) {
        labelsByCanvas.delete(canvasId(this.canvas));
      }
      return originalClearRect.call(this, x, y, width, height);
    };
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
    return { slope, intercept, error, logarithmic };
  }

  function selectScale() {
    if (!markerState) return null;
    const groups = [...labelsByCanvas.values()].map((records) => [...records.values()])
      .map((points) => {
        const deduped = new Map();
        points.filter((point) => Date.now() - point.updatedAt < 30_000).forEach((point) => deduped.set(Math.round(point.y), point));
        return [...deduped.values()].sort((a, b) => a.y - b.y);
      }).filter((points) => points.length >= 2);
    const modes = [];
    if (Number(markerState.currentPrice) > 0) modes.push({ type: 'PRICE', factor: 1, current: Number(markerState.currentPrice) });
    if (Number(markerState.currentMarketCap) > 0) {
      [1, 1e3, 1e6, 1e9].forEach((factor) => modes.push({ type: 'MARKET_CAP', factor, current: Number(markerState.currentMarketCap) / factor }));
    }
    let best = null;
    groups.forEach((points) => modes.forEach((mode) => {
      const nearest = Math.min(...points.map((point) => Math.abs(Math.log(point.value / mode.current))));
      const linear = linearFit(points, false);
      const logarithmic = linearFit(points, true);
      const fit = !linear ? logarithmic : !logarithmic ? linear : linear.error <= logarithmic.error ? linear : logarithmic;
      if (!fit) return;
      const score = nearest + Math.min(2, fit.error / Math.max(80, innerHeight));
      if (!best || score < best.score) best = { ...mode, points, fit, score };
    }));
    return best && best.score < 1.6 ? best : null;
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
    if (!markerState?.markers?.length) {
      root.replaceChildren();
      return;
    }
    const scale = selectScale();
    if (!scale) {
      root.replaceChildren();
      return;
    }
    const nodes = [];
    markerState.markers.forEach((marker) => {
      const rawValue = scale.type === 'MARKET_CAP'
        ? Number(marker.marketCap || 0) / scale.factor
        : Number(marker.price || (markerState.currentPrice * Number(marker.marketCap || 0) / markerState.currentMarketCap) || 0);
      if (!(rawValue > 0)) return;
      const fitX = scale.fit.logarithmic ? Math.log(rawValue) : rawValue;
      const y = scale.fit.slope * fitX + scale.fit.intercept;
      if (!Number.isFinite(y) || y < 35 || y > innerHeight - 55) return;
      const line = document.createElement('div');
      const color = marker.side === 'SELL' ? '#ff6673' : '#42e797';
      Object.assign(line.style, {
        borderTop: `1px dashed ${color}`, color, left: '0', position: 'fixed', right: '58px', top: `${Math.round(y)}px`, opacity: '.94'
      });
      const label = document.createElement('span');
      label.textContent = `${marker.label} · ${compactUsd(scale.type === 'MARKET_CAP' ? marker.marketCap : rawValue)}`;
      Object.assign(label.style, {
        background: 'rgba(12,13,18,.95)', border: `1px solid ${color}`, borderRadius: '5px', color,
        font: '800 10px/1.2 Inter,system-ui,sans-serif', padding: '3px 6px', position: 'absolute', right: '5px', top: '-11px', whiteSpace: 'nowrap'
      });
      line.appendChild(label);
      nodes.push(line);
    });
    root.replaceChildren(...nodes);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'TANGO_PAPER_PARENT' || event.data?.type !== 'CHART_MARKERS') return;
    markerState = event.data.payload || null;
    renderMarkers();
  });
  window.addEventListener('resize', renderMarkers, { passive: true });
  setInterval(renderMarkers, 250);
})();
